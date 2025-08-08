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
import { MongoLogId } from "mongodb-log-writer";

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

export type ExportsManagerConfig = Pick<UserConfig, "exportsPath" | "exportTimeoutMs" | "exportCleanupIntervalMs">;

type ExportsManagerEvents = {
    "export-expired": [string];
    "export-available": [string];
};

export class ExportsManager extends EventEmitter<ExportsManagerEvents> {
    private wasInitialized: boolean = false;
    private isShuttingDown: boolean = false;
    private storedExports: Record<StoredExport["exportName"], StoredExport> = {};
    private exportsCleanupInProgress: boolean = false;
    private exportsCleanupInterval?: NodeJS.Timeout;

    private constructor(
        private readonly exportsDirectoryPath: string,
        private readonly config: ExportsManagerConfig,
        private readonly logger: LoggerBase
    ) {
        super();
    }

    public get availableExports(): AvailableExport[] {
        this.assertIsNotShuttingDown();
        return Object.values(this.storedExports)
            .filter((storedExport) => {
                return (
                    storedExport.exportStatus === "ready" &&
                    !isExportExpired(storedExport.exportCreatedAt, this.config.exportTimeoutMs)
                );
            })
            .map(({ exportName, exportURI, exportPath }) => ({
                exportName,
                exportURI,
                exportPath,
            }));
    }

    protected init(): void {
        if (!this.wasInitialized) {
            this.exportsCleanupInterval = setInterval(
                () => void this.cleanupExpiredExports(),
                this.config.exportCleanupIntervalMs
            );

            this.wasInitialized = true;
        }
    }

    public async close(): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        this.isShuttingDown = true;
        try {
            clearInterval(this.exportsCleanupInterval);
            await fs.rm(this.exportsDirectoryPath, { force: true, recursive: true });
        } catch (error) {
            this.logger.error({
                id: LogId.exportCloseError,
                context: "Error while closing ExportsManager",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    public async readExport(exportName: string): Promise<string> {
        try {
            this.assertIsNotShuttingDown();
            exportName = decodeURIComponent(exportName);
            const exportHandle = this.storedExports[exportName];
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
                context: `Error when reading export - ${exportName}`,
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
            this.assertIsNotShuttingDown();
            const exportNameWithExtension = validateExportName(ensureExtension(exportName, "json"));
            if (this.storedExports[exportNameWithExtension]) {
                throw new Error("Export with same name is either already available or being generated.");
            }
            const exportURI = `exported-data://${encodeURIComponent(exportNameWithExtension)}`;
            const exportFilePath = path.join(this.exportsDirectoryPath, exportNameWithExtension);
            const inProgressExport: InProgressExport = (this.storedExports[exportNameWithExtension] = {
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
        let pipeSuccessful = false;
        try {
            await fs.mkdir(this.exportsDirectoryPath, { recursive: true });
            const outputStream = createWriteStream(inProgressExport.exportPath);
            await pipeline([
                input.stream(),
                this.docToEJSONStream(this.getEJSONOptionsForFormat(jsonExportFormat)),
                outputStream,
            ]);
            pipeSuccessful = true;
        } catch (error) {
            this.logger.error({
                id: LogId.exportCreationError,
                context: `Error when generating JSON export for ${inProgressExport.exportName}`,
                message: error instanceof Error ? error.message : String(error),
            });

            // If the pipeline errors out then we might end up with
            // partial and incorrect export so we remove it entirely.
            await this.silentlyRemoveExport(
                inProgressExport.exportPath,
                LogId.exportCreationCleanupError,
                `Error when removing incomplete export ${inProgressExport.exportName}`
            );
            delete this.storedExports[inProgressExport.exportName];
        } finally {
            if (pipeSuccessful) {
                this.storedExports[inProgressExport.exportName] = {
                    ...inProgressExport,
                    exportCreatedAt: Date.now(),
                    exportStatus: "ready",
                };
                this.emit("export-available", inProgressExport.exportURI);
            }
            void input.close();
        }
    }

    private getEJSONOptionsForFormat(format: JSONExportFormat): EJSONOptions | undefined {
        switch (format) {
            case "relaxed":
                return { relaxed: true };
            case "canonical":
                return { relaxed: false };
            default:
                return undefined;
        }
    }

    private docToEJSONStream(ejsonOptions: EJSONOptions | undefined): Transform {
        let docsTransformed = 0;
        return new Transform({
            objectMode: true,
            transform(chunk: unknown, encoding, callback): void {
                try {
                    const doc = EJSON.stringify(chunk, undefined, undefined, ejsonOptions);
                    if (docsTransformed === 0) {
                        this.push("[" + doc);
                    } else {
                        this.push(",\n" + doc);
                    }
                    docsTransformed++;
                    callback();
                } catch (err) {
                    callback(err as Error);
                }
            },
            flush(callback): void {
                if (docsTransformed === 0) {
                    this.push("[]");
                } else {
                    this.push("]");
                }
                callback();
            },
        });
    }

    private async cleanupExpiredExports(): Promise<void> {
        if (this.exportsCleanupInProgress || this.isShuttingDown) {
            return;
        }

        this.exportsCleanupInProgress = true;
        const exportsForCleanup = Object.values({ ...this.storedExports }).filter(
            (storedExport): storedExport is ReadyExport => storedExport.exportStatus === "ready"
        );
        try {
            for (const { exportPath, exportCreatedAt, exportURI, exportName } of exportsForCleanup) {
                if (isExportExpired(exportCreatedAt, this.config.exportTimeoutMs)) {
                    delete this.storedExports[exportName];
                    await this.silentlyRemoveExport(
                        exportPath,
                        LogId.exportCleanupError,
                        `Considerable error when removing export ${exportName}`
                    );
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

    private async silentlyRemoveExport(exportPath: string, logId: MongoLogId, logContext: string): Promise<void> {
        try {
            await fs.unlink(exportPath);
        } catch (error) {
            // If the file does not exist or the containing directory itself
            // does not exist then we can safely ignore that error anything else
            // we need to flag.
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                this.logger.error({
                    id: logId,
                    context: logContext,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    private assertIsNotShuttingDown(): void {
        if (this.isShuttingDown) {
            throw new Error("ExportsManager is shutting down.");
        }
    }

    static init(sessionId: string, config: ExportsManagerConfig, logger: LoggerBase): ExportsManager {
        const exportsDirectoryPath = path.join(config.exportsPath, sessionId);
        const exportsManager = new ExportsManager(exportsDirectoryPath, config, logger);
        exportsManager.init();
        return exportsManager;
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
