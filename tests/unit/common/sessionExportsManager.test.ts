import path from "path";
import fs from "fs/promises";
import { Readable, Transform } from "stream";
import { FindCursor, Long } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionExportsManager, SessionExportsManagerConfig } from "../../../src/common/sessionExportsManager.js";

import { config } from "../../../src/common/config.js";
import { Session } from "../../../src/common/session.js";
import { ROOT_DIR } from "../../accuracy/sdk/constants.js";
import { timeout } from "../../integration/helpers.js";
import { EJSON, EJSONOptions } from "bson";

const dummySessionId = "1FOO";
const dummyExportsPath = path.join(ROOT_DIR, "tests", "tmp", "exports");
const dummySessionExportPath = path.join(dummyExportsPath, dummySessionId);
const exportsManagerConfig: SessionExportsManagerConfig = {
    exportPath: dummyExportsPath,
    exportTimeoutMs: config.exportTimeoutMs,
    exportCleanupIntervalMs: config.exportCleanupIntervalMs,
} as const;
function getDummyExportName(timestamp: number) {
    return `foo.bar.${timestamp}.json`;
}
function getDummyExportPath(timestamp: number) {
    return path.join(dummySessionExportPath, getDummyExportName(timestamp));
}

async function createDummyExport(timestamp: number) {
    const content = "[]";
    await fs.mkdir(dummySessionExportPath, { recursive: true });
    await fs.writeFile(getDummyExportPath(timestamp), content);
    return {
        name: getDummyExportName(timestamp),
        path: getDummyExportPath(timestamp),
        content,
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

describe("SessionExportsManager integration test", () => {
    let session: Session;
    let manager: SessionExportsManager;

    beforeEach(async () => {
        await manager?.close();
        await fs.rm(exportsManagerConfig.exportPath, { recursive: true, force: true });
        await fs.mkdir(exportsManagerConfig.exportPath, { recursive: true });
        session = new Session({ apiBaseUrl: "" });
        manager = new SessionExportsManager(session, exportsManagerConfig);
    });

    describe("#exportNameToResourceURI", () => {
        it("should throw when export name has no extension", () => {
            expect(() => manager.exportNameToResourceURI("name")).toThrow();
        });

        it("should return a resource URI", () => {
            expect(manager.exportNameToResourceURI("name.json")).toEqual("exported-data://name.json");
        });
    });

    describe("#exportsDirectoryPath", () => {
        it("should throw when session is not initialized", () => {
            expect(() => manager.exportsDirectoryPath()).toThrow();
        });

        it("should return a session path when session is initialized", () => {
            session.sessionId = dummySessionId;
            manager = new SessionExportsManager(session, exportsManagerConfig);
            expect(manager.exportsDirectoryPath()).toEqual(path.join(exportsManagerConfig.exportPath, dummySessionId));
        });
    });

    describe("#exportFilePath", () => {
        it("should throw when export name has no extension", () => {
            expect(() => manager.exportFilePath(dummySessionExportPath, "name")).toThrow();
        });

        it("should return path to provided export file", () => {
            expect(manager.exportFilePath(dummySessionExportPath, "mflix.movies.json")).toEqual(
                path.join(dummySessionExportPath, "mflix.movies.json")
            );
        });
    });

    describe("#readExport", () => {
        it("should throw when export name has no extension", async () => {
            await expect(() => manager.readExport("name")).rejects.toThrow();
        });

        it("should return the resource content", async () => {
            const { name, content } = await createDummyExport(Date.now());
            session.sessionId = dummySessionId;
            manager = new SessionExportsManager(session, exportsManagerConfig);
            expect(await manager.readExport(name)).toEqual(content);
        });
    });

    describe("#createJSONExport", () => {
        let inputCursor: FindCursor;
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
        });

        describe("when cursor is empty", () => {
            it("should create an empty export", async () => {
                inputCursor = createDummyFindCursor([]);

                const emitSpy = vi.spyOn(session, "emit");
                session.sessionId = dummySessionId;
                manager = new SessionExportsManager(session, exportsManagerConfig);
                const timestamp = Date.now();
                await manager.createJSONExport({
                    input: inputCursor,
                    exportName: getDummyExportName(timestamp),
                    jsonExportFormat: "relaxed",
                });

                // Updates available export
                const availableExports = manager.listAvailableExports();
                expect(availableExports).toHaveLength(1);
                expect(availableExports).toContainEqual(
                    expect.objectContaining({
                        name: getDummyExportName(timestamp),
                        uri: `exported-data://${getDummyExportName(timestamp)}`,
                    })
                );

                // Emit event
                expect(emitSpy).toHaveBeenCalledWith(
                    "export-available",
                    `exported-data://${getDummyExportName(timestamp)}`
                );

                // Exports relaxed json
                const jsonData = JSON.parse(await manager.readExport(getDummyExportName(timestamp))) as unknown[];
                expect(jsonData).toEqual([]);
            });
        });

        describe.each([
            { cond: "when exportName does not contain extension", exportName: `foo.bar.${Date.now()}` },
            { cond: "when exportName contains extension", exportName: `foo.bar.${Date.now()}.json` },
        ])("$cond", ({ exportName }) => {
            it("should export relaxed json, update available exports and emit export-available event", async () => {
                const emitSpy = vi.spyOn(session, "emit");
                session.sessionId = dummySessionId;
                manager = new SessionExportsManager(session, exportsManagerConfig);
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
                const emitSpy = vi.spyOn(session, "emit");
                session.sessionId = dummySessionId;
                manager = new SessionExportsManager(session, exportsManagerConfig);
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
                const jsonData = JSON.parse(await manager.readExport(expectedExportName)) as unknown[];
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
                const emitSpy = vi.spyOn(session, "emit");
                session.sessionId = dummySessionId;
                manager = new SessionExportsManager(session, exportsManagerConfig);
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

                const timestamp = Date.now();
                const exportName = getDummyExportName(timestamp);
                const exportPath = getDummyExportPath(timestamp);
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

        it("should do nothing if session is not initialized", async () => {
            const { path } = await createDummyExport(Date.now());
            new SessionExportsManager(session, {
                ...exportsManagerConfig,
                exportTimeoutMs: 100,
                exportCleanupIntervalMs: 50,
            });

            expect(await fileExists(path)).toEqual(true);
            await timeout(200);
            expect(await fileExists(path)).toEqual(true);
        });

        it("should cleanup expired exports if session is initialized", async () => {
            session.sessionId = dummySessionId;
            const timestamp = Date.now();
            const exportName = getDummyExportName(timestamp);
            const exportPath = getDummyExportPath(timestamp);
            const manager = new SessionExportsManager(session, {
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
                    uri: `exported-data://${exportName}`,
                })
            );
            expect(await fileExists(exportPath)).toEqual(true);
            await timeout(200);
            expect(manager.listAvailableExports()).toEqual([]);
            expect(await fileExists(exportPath)).toEqual(false);
        });
    });
});
