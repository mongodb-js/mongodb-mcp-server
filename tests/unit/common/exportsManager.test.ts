import path from "path";
import fs from "fs/promises";
import { Readable, Transform } from "stream";
import type { FindCursor } from "mongodb";
import { Long } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportsManagerConfig } from "../../../src/common/exportsManager.js";
import {
    ensureExtension,
    isExportExpired,
    ExportsManager,
    validateExportName,
} from "../../../src/common/exportsManager.js";
import type { AvailableExport } from "../../../src/common/exportsManager.js";
import { config } from "../../../src/common/config.js";
import { ROOT_DIR } from "../../accuracy/sdk/constants.js";
import { timeout } from "../../integration/helpers.js";
import type { EJSONOptions } from "bson";
import { EJSON, ObjectId } from "bson";
import { CompositeLogger } from "../../../src/common/logger.js";

const logger = new CompositeLogger();
const exportsPath = path.join(ROOT_DIR, "tests", "tmp", `exports-${Date.now()}`);
const exportsManagerConfig: ExportsManagerConfig = {
    exportsPath,
    exportTimeoutMs: config.exportTimeoutMs,
    exportCleanupIntervalMs: config.exportCleanupIntervalMs,
} as const;

function getExportNameAndPath({
    uniqueExportsId = new ObjectId().toString(),
    uniqueFileId = new ObjectId().toString(),
    database = "foo",
    collection = "bar",
}:
    | {
          uniqueExportsId?: string;
          uniqueFileId?: string;
          database?: string;
          collection?: string;
      }
    | undefined = {}): {
    sessionExportsPath: string;
    exportName: string;
    exportPath: string;
    exportURI: string;
    uniqueExportsId: string;
} {
    const exportName = `${database}.${collection}.${uniqueFileId}.json`;
    // This is the exports directory for a session.
    const sessionExportsPath = path.join(exportsPath, uniqueExportsId);
    const exportPath = path.join(sessionExportsPath, exportName);
    return {
        sessionExportsPath,
        exportName,
        exportPath,
        exportURI: `exported-data://${exportName}`,
        uniqueExportsId,
    };
}

function createDummyFindCursor(
    dataArray: unknown[],
    beforeEachChunk?: (chunkIndex: number) => void | Promise<void>
): { cursor: FindCursor; cursorCloseNotification: Promise<void> } {
    let index = 0;
    const readable = new Readable({
        objectMode: true,
        async read(): Promise<void> {
            try {
                await beforeEachChunk?.(index);
                if (index < dataArray.length) {
                    this.push(dataArray[index++]);
                } else {
                    this.push(null);
                }
            } catch (error) {
                this.destroy(error as Error);
            }
        },
    });

    let notifyClose: () => Promise<void>;
    const cursorCloseNotification = new Promise<void>((resolve) => {
        notifyClose = async (): Promise<void> => {
            await timeout(10);
            resolve();
        };
    });
    readable.once("close", () => void notifyClose?.());

    return {
        cursor: {
            stream() {
                return readable;
            },
            close() {
                return Promise.resolve(readable.destroy());
            },
        } as unknown as FindCursor,
        cursorCloseNotification,
    };
}

function createDummyFindCursorWithDelay(
    dataArray: unknown[],
    delayMs: number
): { cursor: FindCursor; cursorCloseNotification: Promise<void> } {
    return createDummyFindCursor(dataArray, () => timeout(delayMs));
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function timeoutPromise(timeoutMS: number, context: string): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${context} - Timed out!`)), timeoutMS);
    });
}

async function waitUntilThereIsAnExportAvailable(manager: ExportsManager): Promise<AvailableExport[]> {
    return await vi.waitFor(() => {
        const exports = manager.availableExports;
        expect(exports.length).toBeGreaterThan(0);

        return exports;
    });
}

async function getExportAvailableNotifier(
    expectedExportURI: string,
    manager: ExportsManager,
    timeoutMS = 10_000
): Promise<string> {
    const exportAvailablePromise = new Promise<string>((resolve) => {
        manager.on("export-available", (exportURI) => {
            if (expectedExportURI === exportURI) {
                resolve(exportURI);
            }
        });
    });
    return await Promise.race([
        timeoutPromise(timeoutMS, `Waiting for export-available - ${expectedExportURI}`),
        exportAvailablePromise,
    ]);
}

describe("ExportsManager unit test", () => {
    let manager: ExportsManager;
    let managerClosedPromise: Promise<void>;

    beforeEach(async () => {
        await fs.mkdir(exportsManagerConfig.exportsPath, { recursive: true });
        manager = ExportsManager.init(exportsManagerConfig, logger);

        let notifyManagerClosed: () => void;
        managerClosedPromise = new Promise((resolve): void => {
            notifyManagerClosed = resolve;
        });
        manager.once("closed", (): void => {
            notifyManagerClosed();
        });
    });

    afterEach(async () => {
        await manager?.close();
        await managerClosedPromise;
        await fs.rm(exportsManagerConfig.exportsPath, { recursive: true, force: true });
    });

    describe("#availableExport", () => {
        it("should throw if the manager is shutting down", () => {
            void manager.close();
            expect(() => manager.availableExports).toThrow("ExportsManager is shutting down.");
        });

        it("should list only the exports that are in ready state", async () => {
            // This export will finish in at-least 1 second
            const { exportName: exportName1, uniqueExportsId } = getExportNameAndPath();
            await manager.createJSONExport({
                input: createDummyFindCursorWithDelay([{ name: "Test1" }], 1000).cursor,
                exportName: exportName1,
                exportTitle: "Some export",
                jsonExportFormat: "relaxed",
            });

            // This export will finish way sooner than the first one
            const { exportName: exportName2, exportURI } = getExportNameAndPath({ uniqueExportsId });
            const secondExportNotifier = getExportAvailableNotifier(exportURI, manager);
            const { cursor } = createDummyFindCursor([{ name: "Test1" }]);
            await manager.createJSONExport({
                input: cursor,
                exportName: exportName2,
                exportTitle: "Some export",
                jsonExportFormat: "relaxed",
            });

            await secondExportNotifier;
            expect(manager.availableExports).toHaveLength(1);
            expect(manager.availableExports[0]?.exportName).toEqual(exportName2);
        });
    });

    describe("#readExport", () => {
        it("should throw if the manager is shutting down", async () => {
            void manager.close();
            await expect(() => manager.readExport("name")).rejects.toThrow("ExportsManager is shutting down.");
        });

        it("should notify the user if resource is still being generated", async () => {
            const { exportName } = getExportNameAndPath();
            const { cursor } = createDummyFindCursorWithDelay([{ name: "Test1" }], 200);
            // create only provides a readable handle but does not guarantee
            // that resource is available for read
            await manager.createJSONExport({
                input: cursor,
                exportName,
                exportTitle: "Some export",
                jsonExportFormat: "relaxed",
            });

            try {
                await manager.readExport(exportName);
                throw new Error("Should have failed.");
            } catch (err: unknown) {
                expect(String(err)).toEqual("Error: Requested export is still being generated. Try again later.");
            }
        });

        it("should return the resource content if the resource is ready to be consumed", async () => {
            const { exportName, exportURI } = getExportNameAndPath();
            const { cursor } = createDummyFindCursor([]);
            const exportAvailableNotifier = getExportAvailableNotifier(exportURI, manager);
            await manager.createJSONExport({
                input: cursor,
                exportName,
                exportTitle: "Some export",
                jsonExportFormat: "relaxed",
            });
            await exportAvailableNotifier;
            expect(await manager.readExport(exportName)).toEqual("[]");
        });

        it("should handle encoded name", async () => {
            const { exportName, exportURI } = getExportNameAndPath({ database: "some database", collection: "coll" });
            const { cursor } = createDummyFindCursor([]);
            const exportAvailableNotifier = getExportAvailableNotifier(encodeURI(exportURI), manager);
            await manager.createJSONExport({
                input: cursor,
                exportName: encodeURIComponent(exportName),
                exportTitle: "Some export",
                jsonExportFormat: "relaxed",
            });
            await exportAvailableNotifier;
            expect(await manager.readExport(encodeURIComponent(exportName))).toEqual("[]");
        });
    });

    describe("#createJSONExport", () => {
        let cursor: FindCursor;
        let cursorCloseNotification: Promise<void>;
        let exportName: string;
        let exportPath: string;
        let exportURI: string;
        beforeEach(() => {
            void cursor?.close();
            ({ cursor, cursorCloseNotification } = createDummyFindCursor([
                {
                    name: "foo",
                    longNumber: Long.fromNumber(12),
                },
                {
                    name: "bar",
                    longNumber: Long.fromNumber(123456),
                },
            ]));
            ({ exportName, exportPath, exportURI } = getExportNameAndPath());
        });

        it("should throw if the manager is shutting down", async () => {
            const { cursor } = createDummyFindCursor([]);
            void manager.close();
            await expect(() =>
                manager.createJSONExport({
                    input: cursor,
                    exportName,
                    exportTitle: "Some export",
                    jsonExportFormat: "relaxed",
                })
            ).rejects.toThrow();
        });

        it("should throw if the same name export is requested more than once", async () => {
            await manager.createJSONExport({
                input: createDummyFindCursor([{ name: 1 }, { name: 2 }]).cursor,
                exportName,
                exportTitle: "Export title 1",
                jsonExportFormat: "relaxed",
            });
            await expect(() =>
                manager.createJSONExport({
                    input: createDummyFindCursor([{ name: 1 }, { name: 2 }]).cursor,
                    exportName,
                    exportTitle: "Export title 2",
                    jsonExportFormat: "relaxed",
                })
            ).rejects.toThrow("Export with same name is either already available or being generated");
        });

        describe("when cursor is empty", () => {
            it("should create an empty export", async () => {
                const { cursor, cursorCloseNotification } = createDummyFindCursor([]);

                const emitSpy = vi.spyOn(manager, "emit");
                await manager.createJSONExport({
                    input: cursor,
                    exportName,
                    exportTitle: "Some export",
                    jsonExportFormat: "relaxed",
                });
                await cursorCloseNotification;

                // Updates available export
                // this is async code so we should wait and retry
                const availableExports = await waitUntilThereIsAnExportAvailable(manager);
                expect(availableExports).toHaveLength(1);
                expect(availableExports).toContainEqual(
                    expect.objectContaining({
                        exportName,
                        exportURI,
                    })
                );

                // Emit event
                expect(emitSpy).toHaveBeenCalledWith("export-available", exportURI);

                // Exports relaxed json
                const jsonData = JSON.parse(await manager.readExport(exportName)) as unknown[];
                expect(jsonData).toEqual([]);
            });
        });

        describe.each([
            { cond: "when exportName does not contain extension", exportName: `foo.bar.${Date.now()}` },
            { cond: "when exportName contains extension", exportName: `foo.bar.${Date.now()}.json` },
        ])("$cond", ({ exportName }) => {
            it("should export relaxed json, update available exports and emit export-available event", async () => {
                const emitSpy = vi.spyOn(manager, "emit");
                await manager.createJSONExport({
                    input: cursor,
                    exportName,
                    exportTitle: "Some export",
                    jsonExportFormat: "relaxed",
                });
                await cursorCloseNotification;

                const expectedExportName = exportName.endsWith(".json") ? exportName : `${exportName}.json`;
                // Updates available export
                const availableExports = await waitUntilThereIsAnExportAvailable(manager);
                expect(availableExports).toHaveLength(1);
                expect(availableExports).toContainEqual(
                    expect.objectContaining({
                        exportName: expectedExportName,
                        exportURI: `exported-data://${expectedExportName}`,
                    })
                );

                // Emit event
                expect(emitSpy).toHaveBeenCalledWith("export-available", `exported-data://${expectedExportName}`);

                // Exports relaxed json
                const jsonData = JSON.parse(await manager.readExport(expectedExportName)) as unknown[];
                expect(jsonData).toContainEqual(expect.objectContaining({ name: "foo", longNumber: 12 }));
                expect(jsonData).toContainEqual(expect.objectContaining({ name: "bar", longNumber: 123456 }));
            });
        });

        describe.each([
            { cond: "when exportName does not contain extension", exportName: `foo.bar.${Date.now()}` },
            { cond: "when exportName contains extension", exportName: `foo.bar.${Date.now()}.json` },
        ])("$cond", ({ exportName }) => {
            it("should export canonical json, update available exports and emit export-available event", async () => {
                const emitSpy = vi.spyOn(manager, "emit");
                await manager.createJSONExport({
                    input: cursor,
                    exportName,
                    exportTitle: "Some export",
                    jsonExportFormat: "canonical",
                });
                await cursorCloseNotification;

                const expectedExportName = exportName.endsWith(".json") ? exportName : `${exportName}.json`;
                // Updates available export
                const availableExports = await waitUntilThereIsAnExportAvailable(manager);
                expect(availableExports).toHaveLength(1);
                expect(availableExports).toContainEqual(
                    expect.objectContaining({
                        exportName: expectedExportName,
                        exportURI: `exported-data://${expectedExportName}`,
                    })
                );

                // Emit event
                expect(emitSpy).toHaveBeenCalledWith("export-available", `exported-data://${expectedExportName}`);

                // Exports relaxed json
                const jsonData = JSON.parse(await manager.readExport(expectedExportName)) as unknown[];
                expect(jsonData).toContainEqual(
                    expect.objectContaining({ name: "foo", longNumber: { $numberLong: "12" } })
                );
                expect(jsonData).toContainEqual(
                    expect.objectContaining({ name: "bar", longNumber: { $numberLong: "123456" } })
                );
            });
        });

        describe("when there is an error during stream transform", () => {
            it("should remove the partial export and never make it available", async () => {
                const emitSpy = vi.spyOn(manager, "emit");
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
                (manager as any).docToEJSONStream = function (ejsonOptions: EJSONOptions | undefined): Transform {
                    let docsTransformed = 0;
                    return new Transform({
                        objectMode: true,
                        transform(chunk: unknown, encoding, callback): void {
                            try {
                                const doc = EJSON.stringify(chunk, undefined, undefined, ejsonOptions);
                                if (docsTransformed === 0) {
                                    this.push("[" + doc);
                                } else if (docsTransformed === 1) {
                                    throw new Error("Could not transform the chunk!");
                                } else {
                                    this.push(",\n" + doc);
                                }
                                docsTransformed++;
                                callback();
                            } catch (err) {
                                callback(err as Error);
                            }
                        },
                        flush(this: Transform, cb): void {
                            if (docsTransformed === 0) {
                                this.push("[]");
                            } else {
                                this.push("]");
                            }
                            cb();
                        },
                    });
                };
                await manager.createJSONExport({
                    input: cursor,
                    exportName,
                    exportTitle: "Some export",
                    jsonExportFormat: "relaxed",
                });
                await cursorCloseNotification;

                // Because the export was never populated in the available exports.
                await expect(() => manager.readExport(exportName)).rejects.toThrow(
                    "Requested export has either expired or does not exist."
                );
                expect(emitSpy).not.toHaveBeenCalled();
                expect(manager.availableExports).toEqual([]);
                expect(await fileExists(exportPath)).toEqual(false);
            });
        });

        describe("when there is an error on read stream", () => {
            it("should remove the partial export and never make it available", async () => {
                const emitSpy = vi.spyOn(manager, "emit");
                // A cursor that will make the read stream fail after the first chunk
                const { cursor, cursorCloseNotification } = createDummyFindCursor([{ name: "Test1" }], (chunkIndex) => {
                    if (chunkIndex > 0) {
                        return Promise.reject(new Error("Connection timedout!"));
                    }
                    return Promise.resolve();
                });
                await manager.createJSONExport({
                    input: cursor,
                    exportName,
                    exportTitle: "Some export",
                    jsonExportFormat: "relaxed",
                });
                await cursorCloseNotification;

                // Because the export was never populated in the available exports.
                await expect(() => manager.readExport(exportName)).rejects.toThrow(
                    "Requested export has either expired or does not exist."
                );
                expect(emitSpy).not.toHaveBeenCalled();
                expect(manager.availableExports).toEqual([]);
                expect(await fileExists(exportPath)).toEqual(false);
            });
        });
    });

    describe("#cleanupExpiredExports", () => {
        let cursor: FindCursor;
        let cursorCloseNotification: Promise<void>;
        beforeEach(() => {
            void cursor?.close();
            ({ cursor, cursorCloseNotification } = createDummyFindCursor([
                {
                    name: "foo",
                    longNumber: Long.fromNumber(12),
                },
                {
                    name: "bar",
                    longNumber: Long.fromNumber(123456),
                },
            ]));
        });

        it("should not clean up in-progress exports", async () => {
            const { exportName, uniqueExportsId } = getExportNameAndPath();
            const manager = ExportsManager.init(
                {
                    ...exportsManagerConfig,
                    exportTimeoutMs: 100,
                    exportCleanupIntervalMs: 50,
                },
                new CompositeLogger(),
                uniqueExportsId
            );
            const { cursor } = createDummyFindCursorWithDelay([{ name: "Test" }], 2000);
            await manager.createJSONExport({
                input: cursor,
                exportName,
                exportTitle: "Some export",
                jsonExportFormat: "relaxed",
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            expect((manager as any).storedExports[exportName]?.exportStatus).toEqual("in-progress");

            // After clean up interval the export should still be there
            await timeout(200);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            expect((manager as any).storedExports[exportName]?.exportStatus).toEqual("in-progress");
        });

        it("should cleanup expired exports", async () => {
            const { exportName, exportPath, exportURI, uniqueExportsId } = getExportNameAndPath();
            const manager = ExportsManager.init(
                {
                    ...exportsManagerConfig,
                    exportTimeoutMs: 100,
                    exportCleanupIntervalMs: 50,
                },
                new CompositeLogger(),
                uniqueExportsId
            );
            await manager.createJSONExport({
                input: cursor,
                exportName,
                exportTitle: "Some export",
                jsonExportFormat: "relaxed",
            });
            await cursorCloseNotification;

            expect(manager.availableExports).toContainEqual(
                expect.objectContaining({
                    exportName,
                    exportURI,
                })
            );
            expect(await fileExists(exportPath)).toEqual(true);
            await timeout(200);
            expect(manager.availableExports).toEqual([]);
            expect(await fileExists(exportPath)).toEqual(false);
        });
    });

    describe("#close", () => {
        it("should abort ongoing export and remove partial file", async () => {
            const { exportName, exportPath } = getExportNameAndPath();
            const { cursor } = createDummyFindCursorWithDelay([{ name: "Test" }], 2000);
            await manager.createJSONExport({
                input: cursor,
                exportName,
                exportTitle: "Some export",
                jsonExportFormat: "relaxed",
            });
            // Give the pipeline a brief moment to start and create the file
            await timeout(50);

            await manager.close();

            await expect(fileExists(exportPath)).resolves.toEqual(false);
        });
    });
});

describe("#ensureExtension", () => {
    it("should append provided extension when not present", () => {
        expect(ensureExtension("random", "json")).toEqual("random.json");
        expect(ensureExtension("random.1234", "json")).toEqual("random.1234.json");
        expect(ensureExtension("/random/random-file", "json")).toEqual("/random/random-file.json");
    });
    it("should not append provided when present", () => {
        expect(ensureExtension("random.json", "json")).toEqual("random.json");
        expect(ensureExtension("random.1234.json", "json")).toEqual("random.1234.json");
        expect(ensureExtension("/random/random-file.json", "json")).toEqual("/random/random-file.json");
    });
});

describe("#validateExportName", () => {
    it("should return decoded name when name is valid", () => {
        expect(validateExportName(encodeURIComponent("Test Name.json"))).toEqual("Test Name.json");
    });
    it("should throw when name is invalid", () => {
        expect(() => validateExportName("NoExtension")).toThrow("Provided export name has no extension");
        expect(() => validateExportName("../something.json")).toThrow("Invalid export name: path traversal hinted");
    });
});

describe("#isExportExpired", () => {
    it("should return true if export is expired", () => {
        const createdAt = Date.now() - 1000;
        expect(isExportExpired(createdAt, 500)).toEqual(true);
    });
    it("should return false if export is not expired", () => {
        const createdAt = Date.now();
        expect(isExportExpired(createdAt, 500)).toEqual(false);
    });
});
