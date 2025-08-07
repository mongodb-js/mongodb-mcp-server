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

export type Export = {
    name: string;
    uri: string;
    path: string;
    createdAt: number;
};

export type SessionExportsManagerConfig = Pick<
    UserConfig,
    "exportsPath" | "exportTimeoutMs" | "exportCleanupIntervalMs"
>;

type SessionExportsManagerEvents = {
    "export-expired": [string];
    "export-available": [string];
};

export class SessionExportsManager extends EventEmitter<SessionExportsManagerEvents> {
    private availableExports: Record<Export["name"], Export> = {};
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

    public async close() {
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

    public listAvailableExports(): Export[] {
        return Object.values(this.availableExports).filter(
            ({ createdAt }) => !isExportExpired(createdAt, this.config.exportTimeoutMs)
        );
    }

    public async readExport(exportName: string): Promise<{
        content: string;
        exportURI: string;
    }> {
        try {
            const exportNameWithExtension = validateExportName(exportName);
            const exportHandle = this.availableExports[exportNameWithExtension];
            if (!exportHandle) {
                throw new Error("Requested export has either expired or does not exist!");
            }

            const { path: exportPath, uri, createdAt } = exportHandle;

            if (isExportExpired(createdAt, this.config.exportTimeoutMs)) {
                throw new Error("Requested export has expired!");
            }

            return {
                exportURI: uri,
                content: await fs.readFile(exportPath, "utf8"),
            };
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

    public async createJSONExport({
        input,
        exportName,
        jsonExportFormat,
    }: {
        input: FindCursor;
        exportName: string;
        jsonExportFormat: JSONExportFormat;
    }): Promise<{
        exportURI: string;
        exportPath: string;
    }> {
        try {
            const exportNameWithExtension = validateExportName(ensureExtension(exportName, "json"));
            const exportURI = `exported-data://${encodeURIComponent(exportNameWithExtension)}`;
            const exportFilePath = path.join(this.exportsDirectoryPath, exportNameWithExtension);

            await fs.mkdir(this.exportsDirectoryPath, { recursive: true });
            const inputStream = input.stream();
            const ejsonDocStream = this.docToEJSONStream(this.getEJSONOptionsForFormat(jsonExportFormat));
            const outputStream = createWriteStream(exportFilePath);
            outputStream.write("[");
            let pipeSuccessful = false;
            try {
                await pipeline([inputStream, ejsonDocStream, outputStream]);
                pipeSuccessful = true;
                return {
                    exportURI,
                    exportPath: exportFilePath,
                };
            } catch (pipelineError) {
                // If the pipeline errors out then we might end up with
                // partial and incorrect export so we remove it entirely.
                await fs.unlink(exportFilePath).catch((error) => {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                        this.logger.error({
                            id: LogId.exportCreationCleanupError,
                            context: "Error when removing partial export",
                            message: error instanceof Error ? error.message : String(error),
                        });
                    }
                });
                throw pipelineError;
            } finally {
                void input.close();
                if (pipeSuccessful) {
                    this.availableExports[exportNameWithExtension] = {
                        name: exportNameWithExtension,
                        createdAt: Date.now(),
                        path: exportFilePath,
                        uri: exportURI,
                    };
                    this.emit("export-available", exportURI);
                }
            }
        } catch (error) {
            this.logger.error({
                id: LogId.exportCreationError,
                context: "Error when generating JSON export",
                message: error instanceof Error ? error.message : String(error),
            });
            throw error;
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

    private docToEJSONStream(ejsonOptions: EJSONOptions | undefined) {
        let docsTransformed = 0;
        return new Transform({
            objectMode: true,
            transform: function (chunk: unknown, encoding, callback) {
                ++docsTransformed;
                try {
                    const doc: string = EJSON.stringify(chunk, undefined, 2, ejsonOptions);
                    const line = `${docsTransformed > 1 ? ",\n" : ""}${doc}`;

                    callback(null, line);
                } catch (err: unknown) {
                    callback(err as Error);
                }
            },
            final: function (callback) {
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
        const exportsToBeConsidered = { ...this.availableExports };
        try {
            for (const { path: exportPath, createdAt, uri, name } of Object.values(exportsToBeConsidered)) {
                if (isExportExpired(createdAt, this.config.exportTimeoutMs)) {
                    delete this.availableExports[name];
                    await this.silentlyRemoveExport(exportPath);
                    this.emit("export-expired", uri);
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

    private async silentlyRemoveExport(exportPath: string) {
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

export function isExportExpired(createdAt: number, exportTimeoutMs: number) {
    return Date.now() - createdAt > exportTimeoutMs;
}
