import path from "path";
import fs from "fs/promises";
import { Readable, Transform } from "stream";
import { FindCursor, Long } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    ensureExtension,
    isExportExpired,
    SessionExportsManager,
    SessionExportsManagerConfig,
    validateExportName,
} from "../../../src/common/sessionExportsManager.js";

import { config } from "../../../src/common/config.js";
import { Session } from "../../../src/common/session.js";
import { ROOT_DIR } from "../../accuracy/sdk/constants.js";
import { timeout } from "../../integration/helpers.js";
import { EJSON, EJSONOptions } from "bson";

const exportsPath = path.join(ROOT_DIR, "tests", "tmp", "exports");
const exportsManagerConfig: SessionExportsManagerConfig = {
    exportsPath,
    exportTimeoutMs: config.exportTimeoutMs,
    exportCleanupIntervalMs: config.exportCleanupIntervalMs,
} as const;

function getExportNameAndPath(sessionId: string, timestamp: number) {
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

function createDummyFindCursor(dataArray: unknown[]): FindCursor {
    let index = 0;
    const readable = new Readable({
        objectMode: true,
        read() {
            if (index < dataArray.length) {
                this.push(dataArray[index++]);
            } else {
                this.push(null);
            }
        },
    });

    return {
        stream() {
            return readable;
        },
        close() {
            return Promise.resolve(readable.destroy());
        },
    } as unknown as FindCursor;
}

async function fileExists(filePath: string) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

describe("SessionExportsManager unit test", () => {
    let session: Session;
    let manager: SessionExportsManager;

    beforeEach(async () => {
        await manager?.close();
        await fs.rm(exportsManagerConfig.exportsPath, { recursive: true, force: true });
        await fs.mkdir(exportsManagerConfig.exportsPath, { recursive: true });
        session = new Session({ apiBaseUrl: "" });
        manager = session.exportsManager;
    });

    describe("#readExport", () => {
        it("should throw when export name has no extension", async () => {
            await expect(() => manager.readExport("name")).rejects.toThrow();
        });

        it("should return the resource content", async () => {
            const { exportName, exportURI } = getExportNameAndPath(session.sessionId, Date.now());
            const inputCursor = createDummyFindCursor([]);
            await manager.createJSONExport({
                input: inputCursor,
                exportName,
                jsonExportFormat: "relaxed",
            });
            expect(await manager.readExport(exportName)).toEqual({
                content: "[]",
                exportURI,
            });
        });
    });

    describe("#createJSONExport", () => {
        let inputCursor: FindCursor;
        let exportName: string;
        let exportPath: string;
        let exportURI: string;
        beforeEach(() => {
            void inputCursor?.close();
            inputCursor = createDummyFindCursor([
                {
                    name: "foo",
                    longNumber: Long.fromNumber(12),
                },
                {
                    name: "bar",
                    longNumber: Long.fromNumber(123456),
                },
            ]);
            ({ exportName, exportPath, exportURI } = getExportNameAndPath(session.sessionId, Date.now()));
        });

        describe("when cursor is empty", () => {
            it("should create an empty export", async () => {
                inputCursor = createDummyFindCursor([]);

                const emitSpy = vi.spyOn(manager, "emit");
                await manager.createJSONExport({
                    input: inputCursor,
                    exportName,
                    jsonExportFormat: "relaxed",
                });

                // Updates available export
                const availableExports = manager.listAvailableExports();
                expect(availableExports).toHaveLength(1);
                expect(availableExports).toContainEqual(
                    expect.objectContaining({
                        name: exportName,
                        uri: exportURI,
                    })
                );

                // Emit event
                expect(emitSpy).toHaveBeenCalledWith("export-available", exportURI);

                // Exports relaxed json
                const jsonData = JSON.parse((await manager.readExport(exportName)).content) as unknown[];
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
                    input: inputCursor,
                    exportName,
                    jsonExportFormat: "relaxed",
                });

                const expectedExportName = exportName.endsWith(".json") ? exportName : `${exportName}.json`;
                // Updates available export
                const availableExports = manager.listAvailableExports();
                expect(availableExports).toHaveLength(1);
                expect(availableExports).toContainEqual(
                    expect.objectContaining({
                        name: expectedExportName,
                        uri: `exported-data://${expectedExportName}`,
                    })
                );

                // Emit event
                expect(emitSpy).toHaveBeenCalledWith("export-available", `exported-data://${expectedExportName}`);

                // Exports relaxed json
                const jsonData = JSON.parse((await manager.readExport(expectedExportName)).content) as unknown[];
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
                    input: inputCursor,
                    exportName,
                    jsonExportFormat: "canonical",
                });

                const expectedExportName = exportName.endsWith(".json") ? exportName : `${exportName}.json`;
                // Updates available export
                const availableExports = manager.listAvailableExports();
                expect(availableExports).toHaveLength(1);
                expect(availableExports).toContainEqual(
                    expect.objectContaining({
                        name: expectedExportName,
                        uri: `exported-data://${expectedExportName}`,
                    })
                );

                // Emit event
                expect(emitSpy).toHaveBeenCalledWith("export-available", `exported-data://${expectedExportName}`);

                // Exports relaxed json
                const jsonData = JSON.parse((await manager.readExport(expectedExportName)).content) as unknown[];
                expect(jsonData).toContainEqual(
                    expect.objectContaining({ name: "foo", longNumber: { $numberLong: "12" } })
                );
                expect(jsonData).toContainEqual(
                    expect.objectContaining({ name: "bar", longNumber: { $numberLong: "123456" } })
                );
            });
        });

        describe("when transform stream throws an error", () => {
            it("should remove the partial export and never make it available", async () => {
                const emitSpy = vi.spyOn(manager, "emit");
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
                (manager as any).docToEJSONStream = function (ejsonOptions: EJSONOptions | undefined) {
                    let docsTransformed = 0;
                    return new Transform({
                        objectMode: true,
                        transform: function (chunk: unknown, encoding, callback) {
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
                        final: function (callback) {
                            this.push("]");
                            callback(null);
                        },
                    });
                };

                await expect(() =>
                    manager.createJSONExport({
                        input: inputCursor,
                        exportName,
                        jsonExportFormat: "relaxed",
                    })
                ).rejects.toThrow("Could not transform the chunk!");

                expect(emitSpy).not.toHaveBeenCalled();
                expect(manager.listAvailableExports()).toEqual([]);
                expect(await fileExists(exportPath)).toEqual(false);
            });
        });
    });

    describe("#cleanupExpiredExports", () => {
        let input: FindCursor;
        beforeEach(() => {
            void input?.close();
            input = createDummyFindCursor([
                {
                    name: "foo",
                    longNumber: Long.fromNumber(12),
                },
                {
                    name: "bar",
                    longNumber: Long.fromNumber(123456),
                },
            ]);
        });

        it("should cleanup expired exports", async () => {
            const { exportName, exportPath, exportURI } = getExportNameAndPath(session.sessionId, Date.now());
            const manager = new SessionExportsManager(session.sessionId, {
                ...exportsManagerConfig,
                exportTimeoutMs: 100,
                exportCleanupIntervalMs: 50,
            });
            await manager.createJSONExport({
                input,
                exportName,
                jsonExportFormat: "relaxed",
            });

            expect(manager.listAvailableExports()).toContainEqual(
                expect.objectContaining({
                    name: exportName,
                    uri: exportURI,
                })
            );
            expect(await fileExists(exportPath)).toEqual(true);
            await timeout(200);
            expect(manager.listAvailableExports()).toEqual([]);
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
