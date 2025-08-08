import z from "zod";
import path from "path";
import fs from "fs/promises";
import EventEmitter from "events";
import { createWriteStream } from "fs";
import { FindCursor } from "mongodb";
import { EJSON, EJSONOptions, ObjectId } from "bson";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { MongoLogId } from "mongodb-log-writer";
import { RWLock } from "async-rwlock";

import { UserConfig } from "./config.js";
import { LoggerBase, LogId } from "./logger.js";

export const jsonExportFormat = z.enum(["relaxed", "canonical"]);
export type JSONExportFormat = z.infer<typeof jsonExportFormat>;

interface CommonExportData {
    exportName: string;
    exportTitle: string;
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
type AvailableExport = Pick<StoredExport, "exportName" | "exportTitle" | "exportURI" | "exportPath">;

export type ExportsManagerConfig = Pick<UserConfig, "exportsPath" | "exportTimeoutMs" | "exportCleanupIntervalMs"> & {
    // The maximum number of milliseconds to wait for in-flight operations to
    // settle before shutting down ExportsManager.
    activeOpsDrainTimeoutMs?: number;

    // The maximum number of milliseconds to wait before timing out queued reads
    readTimeout?: number;

    // The maximum number of milliseconds to wait before timing out queued writes
    writeTimeout?: number;
};

type ExportsManagerEvents = {
    "export-expired": [string];
    "export-available": [string];
};

export class ExportsManager extends EventEmitter<ExportsManagerEvents> {
    private storedExports: Record<StoredExport["exportName"], StoredExport> = {};
    private exportsCleanupInProgress: boolean = false;
    private exportsCleanupInterval?: NodeJS.Timeout;
    private readonly shutdownController: AbortController = new AbortController();
    private readonly activeOperations: Set<Promise<unknown>> = new Set();
    private readonly activeOpsDrainTimeoutMs: number;
    private readonly readTimeoutMs: number;
    private readonly writeTimeoutMs: number;
    private readonly exportLocks: Map<string, RWLock> = new Map();

    private constructor(
        private readonly exportsDirectoryPath: string,
        private readonly config: ExportsManagerConfig,
        private readonly logger: LoggerBase
    ) {
        super();
        this.activeOpsDrainTimeoutMs = this.config.activeOpsDrainTimeoutMs ?? 10_000;
        this.readTimeoutMs = this.config.readTimeout ?? 30_0000; // 30 seconds is the default timeout for an MCP request
        this.writeTimeoutMs = this.config.writeTimeout ?? 120_000; // considering that writes can take time
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
            .map(({ exportName, exportTitle, exportURI, exportPath }) => ({
                exportName,
                exportTitle,
                exportURI,
                exportPath,
            }));
    }

    protected init(): void {
        if (!this.exportsCleanupInterval) {
            this.exportsCleanupInterval = setInterval(
                () => void this.trackOperation(this.cleanupExpiredExports()),
                this.config.exportCleanupIntervalMs
            );
        }
    }
    public async close(): Promise<void> {
        if (this.shutdownController.signal.aborted) {
            return;
        }
        try {
            clearInterval(this.exportsCleanupInterval);
            this.shutdownController.abort();
            await this.waitForActiveOperationsToSettle(this.activeOpsDrainTimeoutMs);
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
            return await this.withLock(exportName, "read", false, async (): Promise<string> => {
                const exportHandle = this.storedExports[exportName];
                if (!exportHandle) {
                    throw new Error("Requested export has either expired or does not exist!");
                }

                // This won't happen anymore because of lock synchronization but
                // keeping it here to make TS happy.
                if (exportHandle.exportStatus === "in-progress") {
                    throw new Error("Requested export is still being generated!");
                }

                const { exportPath } = exportHandle;

                return await this.trackOperation(
                    fs.readFile(exportPath, { encoding: "utf8", signal: this.shutdownController.signal })
                );
            });
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

    public async createJSONExport({
        input,
        exportName,
        exportTitle,
        jsonExportFormat,
    }: {
        input: FindCursor;
        exportName: string;
        exportTitle: string;
        jsonExportFormat: JSONExportFormat;
    }): Promise<AvailableExport> {
        try {
            this.assertIsNotShuttingDown();
            const exportNameWithExtension = validateExportName(ensureExtension(exportName, "json"));
            return await this.withLock(exportNameWithExtension, "write", false, (): AvailableExport => {
                if (this.storedExports[exportNameWithExtension]) {
                    throw new Error("Export with same name is either already available or being generated.");
                }
                const exportURI = `exported-data://${encodeURIComponent(exportNameWithExtension)}`;
                const exportFilePath = path.join(this.exportsDirectoryPath, exportNameWithExtension);
                const inProgressExport: InProgressExport = (this.storedExports[exportNameWithExtension] = {
                    exportName: exportNameWithExtension,
                    exportTitle,
                    exportPath: exportFilePath,
                    exportURI: exportURI,
                    exportStatus: "in-progress",
                });

                void this.trackOperation(this.startExport({ input, jsonExportFormat, inProgressExport }));
                return inProgressExport;
            });
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
        await this.withLock(inProgressExport.exportName, "write", false, async (): Promise<void> => {
            try {
                await fs.mkdir(this.exportsDirectoryPath, { recursive: true });
                const outputStream = createWriteStream(inProgressExport.exportPath);
                await pipeline(
                    [
                        input.stream(),
                        this.docToEJSONStream(this.getEJSONOptionsForFormat(jsonExportFormat)),
                        outputStream,
                    ],
                    { signal: this.shutdownController.signal }
                );
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
        });
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
        if (this.exportsCleanupInProgress) {
            return;
        }

        this.exportsCleanupInProgress = true;
        try {
            const exportsForCleanup = Object.values({ ...this.storedExports }).filter(
                (storedExport): storedExport is ReadyExport => storedExport.exportStatus === "ready"
            );

            await Promise.allSettled(
                exportsForCleanup.map(async ({ exportPath, exportCreatedAt, exportURI, exportName }) => {
                    if (isExportExpired(exportCreatedAt, this.config.exportTimeoutMs)) {
                        await this.withLock(exportName, "write", true, async (): Promise<void> => {
                            delete this.storedExports[exportName];
                            await this.silentlyRemoveExport(
                                exportPath,
                                LogId.exportCleanupError,
                                `Considerable error when removing export ${exportName}`
                            );
                            this.emit("export-expired", exportURI);
                        });
                    }
                })
            );
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
        if (this.shutdownController.signal.aborted) {
            throw new Error("ExportsManager is shutting down.");
        }
    }

    private async withLock<T>(
        exportName: string,
        mode: "read" | "write",
        finalize: boolean,
        fn: () => T | Promise<T>
    ): Promise<T> {
        let lock = this.exportLocks.get(exportName);
        if (!lock) {
            lock = new RWLock();
            this.exportLocks.set(exportName, lock);
        }

        try {
            if (mode === "read") {
                await lock.readLock(this.readTimeoutMs);
            } else {
                await lock.writeLock(this.writeTimeoutMs);
            }
            return await fn();
        } finally {
            lock.unlock();
            if (finalize) {
                this.exportLocks.delete(exportName);
            }
        }
    }

    private async trackOperation<T>(promise: Promise<T>): Promise<T> {
        this.activeOperations.add(promise);
        try {
            return await promise;
        } finally {
            this.activeOperations.delete(promise);
        }
    }

    private async waitForActiveOperationsToSettle(timeoutMs: number): Promise<void> {
        const pendingPromises = Array.from(this.activeOperations);
        if (pendingPromises.length === 0) {
            return;
        }
        let timedOut = false;
        const timeoutPromise = new Promise<void>((resolve) =>
            setTimeout(() => {
                timedOut = true;
                resolve();
            }, timeoutMs)
        );
        await Promise.race([Promise.allSettled(pendingPromises), timeoutPromise]);
        if (timedOut && this.activeOperations.size > 0) {
            this.logger.error({
                id: LogId.exportCloseError,
                context: `Close timed out waiting for ${this.activeOperations.size} operation(s) to settle`,
                message: "Proceeding to force cleanup after timeout",
            });
        }
    }

    static init(
        config: ExportsManagerConfig,
        logger: LoggerBase,
        sessionId = new ObjectId().toString()
    ): ExportsManager {
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
