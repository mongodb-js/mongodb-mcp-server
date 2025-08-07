import z from "zod";
import path from "path";
import fs from "fs/promises";
import EventEmitter from "events";
import { createWriteStream } from "fs";
import { FindCursor } from "mongodb";
import { EJSON, EJSONOptions } from "bson";
import { Transform } from "stream";
import { pipeline } from "stream/promises";

import { UserConfig } from "./config.js";
import { LoggerBase, LogId } from "./logger.js";

export const jsonExportFormat = z.enum(["relaxed", "canonical"]);
export type JSONExportFormat = z.infer<typeof jsonExportFormat>;

interface CommonExportData {
    exportName: string;
    exportURI: string;
    exportPath: string;
}

interface ReadyExport extends CommonExportData {
    exportStatus: "ready";
    exportCreatedAt: number;
}

interface InProgressExport extends CommonExportData {
    exportStatus: "in-progress";
}

type StoredExport = ReadyExport | InProgressExport;

/**
 * Ideally just exportName and exportURI should be made publicly available but
 * we also make exportPath available because the export tool, also returns the
 * exportPath in its response when the MCP server is running connected to stdio
 * transport. The reasoning behind this is that a few clients, Cursor in
 * particular, as of the date of this writing (7 August 2025) cannot refer to
 * resource URIs which means they have no means to access the exported resource.
 * As of this writing, majority of the usage of our MCP server is behind STDIO
 * transport so we can assume that for most of the usages, if not all, the MCP
 * server will be running on the same machine as of the MCP client and thus we
 * can provide the local path to export so that these clients which do not still
 * support parsing resource URIs, can still work with the exported data. We
 * expect for clients to catch up and implement referencing resource URIs at
 * which point it would be safe to remove the `exportPath` from the publicly
 * exposed properties of an export.
 *
 * The editors that we would like to watch out for are Cursor and Windsurf as
 * they don't yet support working with Resource URIs.
 *
 * Ref Cursor: https://forum.cursor.com/t/cursor-mcp-resource-feature-support/50987
 * JIRA: https://jira.mongodb.org/browse/MCP-104 */
type AvailableExport = Pick<StoredExport, "exportName" | "exportURI" | "exportPath">;

export type SessionExportsManagerConfig = Pick<
    UserConfig,
    "exportsPath" | "exportTimeoutMs" | "exportCleanupIntervalMs"
>;

type SessionExportsManagerEvents = {
    "export-expired": [string];
    "export-available": [string];
};

export class SessionExportsManager extends EventEmitter<SessionExportsManagerEvents> {
    private sessionExports: Record<StoredExport["exportName"], StoredExport> = {};
    private exportsCleanupInProgress: boolean = false;
    private exportsCleanupInterval: NodeJS.Timeout;
    private exportsDirectoryPath: string;

    constructor(
        readonly sessionId: string,
        private readonly config: SessionExportsManagerConfig,
        private readonly logger: LoggerBase
    ) {
        super();
        this.exportsDirectoryPath = path.join(this.config.exportsPath, sessionId);
        this.exportsCleanupInterval = setInterval(
            () => void this.cleanupExpiredExports(),
            this.config.exportCleanupIntervalMs
        );
    }

    public get availableExports(): AvailableExport[] {
        return Object.values(this.sessionExports)
            .filter((sessionExport) => {
                return (
                    sessionExport.exportStatus === "ready" &&
                    !isExportExpired(sessionExport.exportCreatedAt, this.config.exportTimeoutMs)
                );
            })
            .map(({ exportName, exportURI, exportPath }) => ({
                exportName,
                exportURI,
                exportPath,
            }));
    }

    public async close(): Promise<void> {
        try {
            clearInterval(this.exportsCleanupInterval);
            await fs.rm(this.exportsDirectoryPath, { force: true, recursive: true });
        } catch (error) {
            this.logger.error({
                id: LogId.exportCloseError,
                context: "Error while closing SessionExportManager",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    public async readExport(exportName: string): Promise<string> {
        try {
            const exportNameWithExtension = validateExportName(exportName);
            const exportHandle = this.sessionExports[exportNameWithExtension];
            if (!exportHandle) {
                throw new Error("Requested export has either expired or does not exist!");
            }

            if (exportHandle.exportStatus === "in-progress") {
                throw new Error("Requested export is still being generated!");
            }

            const { exportPath, exportCreatedAt } = exportHandle;

            if (isExportExpired(exportCreatedAt, this.config.exportTimeoutMs)) {
                throw new Error("Requested export has expired!");
            }

            return await fs.readFile(exportPath, "utf8");
        } catch (error) {
            this.logger.error({
                id: LogId.exportReadError,
                context: "Error when reading export",
                message: error instanceof Error ? error.message : String(error),
            });
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                throw new Error("Requested export does not exist!");
            }
            throw error;
        }
    }

    public createJSONExport({
        input,
        exportName,
        jsonExportFormat,
    }: {
        input: FindCursor;
        exportName: string;
        jsonExportFormat: JSONExportFormat;
    }): AvailableExport {
        try {
            const exportNameWithExtension = validateExportName(ensureExtension(exportName, "json"));
            const exportURI = `exported-data://${encodeURIComponent(exportNameWithExtension)}`;
            const exportFilePath = path.join(this.exportsDirectoryPath, exportNameWithExtension);
            const inProgressExport: InProgressExport = (this.sessionExports[exportNameWithExtension] = {
                exportName: exportNameWithExtension,
                exportPath: exportFilePath,
                exportURI: exportURI,
                exportStatus: "in-progress",
            });

            void this.startExport({ input, jsonExportFormat, inProgressExport });
            return inProgressExport;
        } catch (error) {
            this.logger.error({
                id: LogId.exportCreationError,
                context: "Error when registering JSON export request",
                message: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    private async startExport({
        input,
        jsonExportFormat,
        inProgressExport,
    }: {
        input: FindCursor;
        jsonExportFormat: JSONExportFormat;
        inProgressExport: InProgressExport;
    }): Promise<void> {
        try {
            await fs.mkdir(this.exportsDirectoryPath, { recursive: true });
            const inputStream = input.stream();
            const ejsonDocStream = this.docToEJSONStream(this.getEJSONOptionsForFormat(jsonExportFormat));
            const outputStream = createWriteStream(inProgressExport.exportPath);
            outputStream.write("[");
            let pipeSuccessful = false;
            try {
                await pipeline([inputStream, ejsonDocStream, outputStream]);
                pipeSuccessful = true;
            } catch (pipelineError) {
                // If the pipeline errors out then we might end up with
                // partial and incorrect export so we remove it entirely.
                await fs.unlink(inProgressExport.exportPath).catch((error) => {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                        this.logger.error({
                            id: LogId.exportCreationCleanupError,
                            context: "Error when removing partial export",
                            message: error instanceof Error ? error.message : String(error),
                        });
                    }
                });
                delete this.sessionExports[inProgressExport.exportName];
                throw pipelineError;
            } finally {
                if (pipeSuccessful) {
                    this.sessionExports[inProgressExport.exportName] = {
                        ...inProgressExport,
                        exportCreatedAt: Date.now(),
                        exportStatus: "ready",
                    };
                    this.emit("export-available", inProgressExport.exportURI);
                }
                void input.close();
            }
        } catch (error) {
            this.logger.error({
                id: LogId.exportCreationError,
                context: "Error when generating JSON export",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private getEJSONOptionsForFormat(format: JSONExportFormat): EJSONOptions | undefined {
        if (format === "relaxed") {
            return {
                relaxed: true,
            };
        }
        return format === "canonical"
            ? {
                  relaxed: false,
              }
            : undefined;
    }

    private docToEJSONStream(ejsonOptions: EJSONOptions | undefined): Transform {
        let docsTransformed = 0;
        return new Transform({
            objectMode: true,
            transform: function (chunk: unknown, encoding, callback): void {
                ++docsTransformed;
                try {
                    const doc: string = EJSON.stringify(chunk, undefined, undefined, ejsonOptions);
                    const line = `${docsTransformed > 1 ? ",\n" : ""}${doc}`;

                    callback(null, line);
                } catch (err: unknown) {
                    callback(err as Error);
                }
            },
            final: function (callback): void {
                this.push("]");
                callback(null);
            },
        });
    }

    private async cleanupExpiredExports(): Promise<void> {
        if (this.exportsCleanupInProgress) {
            return;
        }

        this.exportsCleanupInProgress = true;
        const exportsForCleanup = Object.values({ ...this.sessionExports }).filter(
            (sessionExport): sessionExport is ReadyExport => sessionExport.exportStatus === "ready"
        );
        try {
            for (const { exportPath, exportCreatedAt, exportURI, exportName } of exportsForCleanup) {
                if (isExportExpired(exportCreatedAt, this.config.exportTimeoutMs)) {
                    delete this.sessionExports[exportName];
                    await this.silentlyRemoveExport(exportPath);
                    this.emit("export-expired", exportURI);
                }
            }
        } catch (error) {
            this.logger.error({
                id: LogId.exportCleanupError,
                context: "Error when cleaning up exports",
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.exportsCleanupInProgress = false;
        }
    }

    private async silentlyRemoveExport(exportPath: string): Promise<void> {
        try {
            await fs.unlink(exportPath);
        } catch (error) {
            // If the file does not exist or the containing directory itself
            // does not exist then we can safely ignore that error anything else
            // we need to flag.
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                this.logger.error({
                    id: LogId.exportCleanupError,
                    context: "Considerable error when removing export file",
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
}

/**
 * Ensures the path ends with the provided extension */
export function ensureExtension(pathOrName: string, extension: string): string {
    const extWithDot = extension.startsWith(".") ? extension : `.${extension}`;
    if (pathOrName.endsWith(extWithDot)) {
        return pathOrName;
    }
    return `${pathOrName}${extWithDot}`;
}

/**
 * Small utility to decoding and validating provided export name for path
 * traversal or no extension */
export function validateExportName(nameWithExtension: string): string {
    const decodedName = decodeURIComponent(nameWithExtension);
    if (!path.extname(decodedName)) {
        throw new Error("Provided export name has no extension");
    }

    if (decodedName.includes("..") || decodedName.includes("/") || decodedName.includes("\\")) {
        throw new Error("Invalid export name: path traversal hinted");
    }

    return decodedName;
}

export function isExportExpired(createdAt: number, exportTimeoutMs: number): boolean {
    return Date.now() - createdAt > exportTimeoutMs;
}
