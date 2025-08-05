import z from "zod";
import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { lock } from "proper-lockfile";
import { FindCursor } from "mongodb";
import { EJSON, EJSONOptions } from "bson";
import { Transform } from "stream";
import { pipeline } from "stream/promises";

import { UserConfig } from "./config.js";
import { Session } from "./session.js";
import logger, { LogId } from "./logger.js";

export const jsonExportFormat = z.enum(["relaxed", "canonical"]);
export type JSONExportFormat = z.infer<typeof jsonExportFormat>;

export type Export = {
    name: string;
    uri: string;
    createdAt: number;
};

export type SessionExportsManagerConfig = Pick<
    UserConfig,
    "exportPath" | "exportTimeoutMs" | "exportCleanupIntervalMs"
>;

export class SessionExportsManager {
    private mutableExports: Export[] = [];
    private exportsCleanupInterval: NodeJS.Timeout;
    private exportsCleanupInProgress: boolean = false;

    constructor(
        private readonly session: Session,
        private readonly config: SessionExportsManagerConfig
    ) {
        this.exportsCleanupInterval = setInterval(
            () => void this.cleanupExpiredExports(),
            this.config.exportCleanupIntervalMs
        );
    }

    public async close() {
        try {
            clearInterval(this.exportsCleanupInterval);
            const exportsDirectory = this.exportsDirectoryPath();
            await fs.rm(exportsDirectory, { force: true, recursive: true });
        } catch (error) {
            logger.error(
                LogId.exportCloseError,
                "Error while closing SessionExportManager",
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    public exportNameToResourceURI(nameWithExtension: string): string {
        if (!path.extname(nameWithExtension)) {
            throw new Error("Provided export name has no extension");
        }
        return `exported-data://${nameWithExtension}`;
    }

    public exportsDirectoryPath(): string {
        // If the session is not connected, we can't cannot work with exports
        // for that session.
        if (!this.session.sessionId) {
            throw new Error("Cannot retrieve exports directory, no active session. Try to reconnect to the MCP server");
        }

        return path.join(this.config.exportPath, this.session.sessionId);
    }

    public exportFilePath(exportsDirectoryPath: string, exportNameWithExtension: string): string {
        if (!path.extname(exportNameWithExtension)) {
            throw new Error("Provided export name has no extension");
        }
        return path.join(exportsDirectoryPath, exportNameWithExtension);
    }

    public listAvailableExports(): Export[] {
        // Note that we don't account for ongoing cleanup or creation operation,
        // by not acquiring a lock on read. That is because this we require this
        // interface to be fast and just accurate enough for MCP completions
        // API.
        return this.mutableExports.filter(({ createdAt }) => {
            return !this.isExportExpired(createdAt);
        });
    }

    public async readExport(exportNameWithExtension: string): Promise<string> {
        try {
            const exportsDirectoryPath = await this.ensureExportsDirectory();
            const exportFilePath = this.exportFilePath(exportsDirectoryPath, exportNameWithExtension);
            if (await this.isExportFileExpired(exportFilePath)) {
                throw new Error("Export has expired");
            }

            return await fs.readFile(exportFilePath, "utf8");
        } catch (error) {
            logger.error(
                LogId.exportReadError,
                "Error when reading export",
                error instanceof Error ? error.message : String(error)
            );
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
    }): Promise<void> {
        try {
            await this.withExportsLock<void>(async (exportsDirectoryPath) => {
                const exportNameWithExtension = this.withExtension(exportName, "json");
                const exportFilePath = path.join(exportsDirectoryPath, exportNameWithExtension);
                const outputStream = createWriteStream(exportFilePath);
                outputStream.write("[");
                try {
                    const inputStream = input.stream();
                    const ejsonOptions = this.getEJSONOptionsForFormat(jsonExportFormat);
                    await pipeline([inputStream, this.docToEJSONStream(ejsonOptions), outputStream]);
                } finally {
                    outputStream.write("]\n");
                    const resourceURI = this.exportNameToResourceURI(exportNameWithExtension);
                    this.mutableExports = [
                        ...this.mutableExports,
                        {
                            createdAt: (await fs.stat(exportFilePath)).birthtimeMs,
                            name: exportNameWithExtension,
                            uri: resourceURI,
                        },
                    ];
                    this.session.emit("export-available", resourceURI);
                    void input.close();
                }
            });
        } catch (error) {
            logger.error(
                LogId.exportCreationError,
                "Error when generating JSON export",
                error instanceof Error ? error.message : String(error)
            );
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
        try {
            await this.withExportsLock(async (exportsDirectoryPath) => {
                const exports = await this.listExportFiles();
                for (const exportName of exports) {
                    const exportPath = this.exportFilePath(exportsDirectoryPath, exportName);
                    if (await this.isExportFileExpired(exportPath)) {
                        await fs.unlink(exportPath);
                        this.mutableExports = this.mutableExports.filter(({ name }) => name !== exportName);
                        this.session.emit("export-expired", this.exportNameToResourceURI(exportName));
                    }
                }
            });
        } catch (error) {
            logger.error(
                LogId.exportCleanupError,
                "Error when cleaning up exports",
                error instanceof Error ? error.message : String(error)
            );
        } finally {
            this.exportsCleanupInProgress = false;
        }
    }

    /**
     * Small utility to centrally determine if an export is expired or not */
    private async isExportFileExpired(exportFilePath: string): Promise<boolean> {
        try {
            const stats = await fs.stat(exportFilePath);
            return this.isExportExpired(stats.birthtimeMs);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                throw new Error("Requested export does not exist!");
            }
            throw error;
        }
    }

    private isExportExpired(createdAt: number) {
        return Date.now() - createdAt > this.config.exportTimeoutMs;
    }

    /**
     * Ensures the path ends with the provided extension */
    private withExtension(pathOrName: string, extension: string): string {
        const extWithDot = extension.startsWith(".") ? extension : `.${extension}`;
        if (path.extname(pathOrName) === extWithDot) {
            return pathOrName;
        }
        return `${pathOrName}${extWithDot}`;
    }

    /**
     * Creates the session exports directory and returns the path */
    private async ensureExportsDirectory(): Promise<string> {
        const exportsDirectoryPath = this.exportsDirectoryPath();
        await fs.mkdir(exportsDirectoryPath, { recursive: true });
        return exportsDirectoryPath;
    }

    /**
     * Acquires a lock on the session exports directory. */
    private async withExportsLock<R>(callback: (lockedPath: string) => Promise<R>): Promise<R> {
        let releaseLock: (() => Promise<void>) | undefined;
        const exportsDirectoryPath = await this.ensureExportsDirectory();
        try {
            releaseLock = await lock(exportsDirectoryPath, { retries: 10 });
            return await callback(exportsDirectoryPath);
        } finally {
            await releaseLock?.();
        }
    }

    /**
     * Lists exported files in the session export directory, while ignoring the
     * hidden files and files without extensions. */
    private async listExportFiles(): Promise<string[]> {
        const exportsDirectory = await this.ensureExportsDirectory();
        const directoryContents = await fs.readdir(exportsDirectory, "utf8");
        return directoryContents.filter((maybeExportName) => {
            return !maybeExportName.startsWith(".") && !!path.extname(maybeExportName);
        });
    }
}
