import path from "path";
import fs from "fs/promises";
import { Readable, Transform } from "stream";
import { FindCursor, Long } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ensureExtension,
    isExportExpired,
    ExportsManager,
    ExportsManagerConfig,
    validateExportName,
} from "../../../src/common/exportsManager.js";

import { config } from "../../../src/common/config.js";
import { Session } from "../../../src/common/session.js";
import { ROOT_DIR } from "../../accuracy/sdk/constants.js";
import { timeout } from "../../integration/helpers.js";
import { EJSON, EJSONOptions, ObjectId } from "bson";
import { CompositeLogger } from "../../../src/common/logger.js";
import { ConnectionManager } from "../../../src/common/connectionManager.js";

const exportsPath = path.join(ROOT_DIR, "tests", "tmp", `exports-${Date.now()}`);
const exportsManagerConfig: ExportsManagerConfig = {
    exportsPath,
    exportTimeoutMs: config.exportTimeoutMs,
    exportCleanupIntervalMs: config.exportCleanupIntervalMs,
} as const;

function getExportNameAndPath(
    sessionId: string,
    timestamp: number
): {
    sessionExportsPath: string;
    exportName: string;
    exportPath: string;
    exportURI: string;
} {
    const exportName = `foo.bar.${timestamp}.json`;
    const sessionExportsPath = path.join(exportsPath, sessionId);
    const exportPath = path.join(sessionExportsPath, exportName);
    return {
        sessionExportsPath,
        exportName,
        exportPath,
        exportURI: `exported-data://${exportName}`,
    };
}

function createDummyFindCursor(
    dataArray: unknown[],
    chunkPushTimeoutMs?: number
): { cursor: FindCursor; cursorCloseNotification: Promise<void> } {
    let index = 0;
    const readable = new Readable({
        objectMode: true,
        async read(): Promise<void> {
            if (index < dataArray.length) {
                if (chunkPushTimeoutMs) {
                    await timeout(chunkPushTimeoutMs);
                }
                this.push(dataArray[index++]);
            } else {
                if (chunkPushTimeoutMs) {
                    await timeout(chunkPushTimeoutMs);
                }
                this.push(null);
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

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

describe("ExportsManager unit test", () => {
    let session: Session;
    let manager: ExportsManager;

    beforeEach(async () => {
        await fs.mkdir(exportsManagerConfig.exportsPath, { recursive: true });
        const logger = new CompositeLogger();
        const sessionId = new ObjectId().toString();
        session = new Session({
            apiBaseUrl: "",
            logger,
            sessionId,
            exportsManager: ExportsManager.init(sessionId, exportsManagerConfig, logger),
            connectionManager: new ConnectionManager(),
        });
        manager = session.exportsManager;
    });

    afterEach(async () => {
        await manager?.close();
        await fs.rm(exportsManagerConfig.exportsPath, { recursive: true, force: true });
    });

    describe("#availableExport", () => {
        it("should list only the exports that are in ready state", async () => {
            // This export will finish in at-least 1 second
            const { exportName: exportName1 } = getExportNameAndPath(session.sessionId, Date.now());
            manager.createJSONExport({
                input: createDummyFindCursor([{ name: "Test1" }], 1000).cursor,
                exportName: exportName1,
                jsonExportFormat: "relaxed",
            });

            // This export will finish way sooner than the first one
            const { exportName: exportName2 } = getExportNameAndPath(session.sessionId, Date.now());
            const { cursor, cursorCloseNotification } = createDummyFindCursor([{ name: "Test1" }]);
            manager.createJSONExport({
                input: cursor,
                exportName: exportName2,
                jsonExportFormat: "relaxed",
            });

            // Small timeout to let the second export finish
            await cursorCloseNotification;
            expect(manager.availableExports).toHaveLength(1);
            expect(manager.availableExports[0]?.exportName).toEqual(exportName2);
        });
    });

    describe("#readExport", () => {
        it("should throw when export name has no extension", async () => {
            await expect(() => manager.readExport("name")).rejects.toThrow();
        });

        it("should throw if the resource is still being generated", async () => {
            const { exportName } = getExportNameAndPath(session.sessionId, Date.now());
            const { cursor } = createDummyFindCursor([{ name: "Test1" }], 100);
            manager.createJSONExport({
                input: cursor,
                exportName,
                jsonExportFormat: "relaxed",
            });
            // note that we do not wait for cursor close
            await expect(() => manager.readExport(exportName)).rejects.toThrow(
                "Requested export is still being generated!"
            );
        });

        it("should return the resource content if the resource is ready to be consumed", async () => {
            const { exportName } = getExportNameAndPath(session.sessionId, Date.now());
            const { cursor, cursorCloseNotification } = createDummyFindCursor([]);
            manager.createJSONExport({
                input: cursor,
                exportName,
                jsonExportFormat: "relaxed",
            });
            await cursorCloseNotification;
            expect(await manager.readExport(exportName)).toEqual("[]");
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
            ({ exportName, exportPath, exportURI } = getExportNameAndPath(session.sessionId, Date.now()));
        });

        describe("when cursor is empty", () => {
            it("should create an empty export", async () => {
                const { cursor, cursorCloseNotification } = createDummyFindCursor([]);

                const emitSpy = vi.spyOn(manager, "emit");
                manager.createJSONExport({
                    input: cursor,
                    exportName,
                    jsonExportFormat: "relaxed",
                });
                await cursorCloseNotification;

                // Updates available export
                const availableExports = manager.availableExports;
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
                manager.createJSONExport({
                    input: cursor,
                    exportName,
                    jsonExportFormat: "relaxed",
                });
                await cursorCloseNotification;

                const expectedExportName = exportName.endsWith(".json") ? exportName : `${exportName}.json`;
                // Updates available export
                const availableExports = manager.availableExports;
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
                manager.createJSONExport({
                    input: cursor,
                    exportName,
                    jsonExportFormat: "canonical",
                });
                await cursorCloseNotification;

                const expectedExportName = exportName.endsWith(".json") ? exportName : `${exportName}.json`;
                // Updates available export
                const availableExports = manager.availableExports;
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

        describe("when there is an error in export generation", () => {
            it("should remove the partial export and never make it available", async () => {
                const emitSpy = vi.spyOn(manager, "emit");
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
                (manager as any).docToEJSONStream = function (ejsonOptions: EJSONOptions | undefined): Transform {
                    let docsTransformed = 0;
                    return new Transform({
                        objectMode: true,
                        transform: function (chunk: unknown, encoding, callback): void {
                            ++docsTransformed;
                            try {
                                if (docsTransformed === 1) {
                                    throw new Error("Could not transform the chunk!");
                                }
                                const doc: string = EJSON.stringify(chunk, undefined, 2, ejsonOptions);
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
                };
                manager.createJSONExport({
                    input: cursor,
                    exportName,
                    jsonExportFormat: "relaxed",
                });
                await cursorCloseNotification;

                // Because the export was never populated in the available exports.
                await expect(() => manager.readExport(exportName)).rejects.toThrow(
                    "Requested export has either expired or does not exist!"
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
            const { exportName } = getExportNameAndPath(session.sessionId, Date.now());
            const manager = ExportsManager.init(
                session.sessionId,
                {
                    ...exportsManagerConfig,
                    exportTimeoutMs: 100,
                    exportCleanupIntervalMs: 50,
                },
                new CompositeLogger()
            );
            const { cursor } = createDummyFindCursor([{ name: "Test" }], 2000);
            manager.createJSONExport({
                input: cursor,
                exportName,
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
            const { exportName, exportPath, exportURI } = getExportNameAndPath(session.sessionId, Date.now());
            const manager = ExportsManager.init(
                session.sessionId,
                {
                    ...exportsManagerConfig,
                    exportTimeoutMs: 100,
                    exportCleanupIntervalMs: 50,
                },
                new CompositeLogger()
            );
            manager.createJSONExport({
                input: cursor,
                exportName,
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
