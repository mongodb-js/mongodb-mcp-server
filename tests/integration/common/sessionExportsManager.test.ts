import path from "path";
import fs from "fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionExportsManager, SessionExportsManagerConfig } from "../../../src/common/sessionExportsManager.js";
import { config } from "../../../src/common/config.js";
import { Session } from "../../../src/common/session.js";
import { ROOT_DIR } from "../../accuracy/sdk/constants.js";
import { FindCursor, Long } from "mongodb";
import { Readable } from "stream";

const dummySessionId = "1FOO";
const dummyExportsPath = path.join(ROOT_DIR, "tests", "tmp", "exports");
const dummySessionExportPath = path.join(dummyExportsPath, dummySessionId);
const exportsManagerConfig: SessionExportsManagerConfig = {
    exportPath: dummyExportsPath,
    exportTimeoutMs: config.exportTimeoutMs,
    exportCleanupIntervalMs: config.exportCleanupIntervalMs,
} as const;
const dummyExportName = "foo.bar.json";
const dummyExportPath = path.join(dummySessionExportPath, dummyExportName);

async function createDummyExport() {
    const content = "[]";
    await fs.mkdir(dummySessionExportPath, { recursive: true });
    await fs.writeFile(dummyExportPath, content);
    return {
        name: dummyExportName,
        path: dummyExportPath,
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

function timeout(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SessionExportsManager integration test", () => {
    let session: Session;
    let manager: SessionExportsManager;

    beforeEach(async () => {
        manager?.close();
        await fs.rm(exportsManagerConfig.exportPath, { recursive: true, force: true });
        await fs.mkdir(exportsManagerConfig.exportPath, { recursive: true });
        session = new Session({ apiBaseUrl: "" });
        manager = new SessionExportsManager(session, exportsManagerConfig);
    });

    describe("#exportNameToResourceURI", function () {
        it("should throw when export name has no extension", function () {
            expect(() => manager.exportNameToResourceURI("name")).toThrow();
        });

        it("should return a resource URI", function () {
            expect(manager.exportNameToResourceURI("name.json")).toEqual("exported-data://name.json");
        });
    });

    describe("#exportsDirectoryPath", function () {
        it("should throw when session is not initialized", function () {
            expect(() => manager.exportsDirectoryPath()).toThrow();
        });

        it("should return a session path when session is initialized", function () {
            session.sessionId = dummySessionId;
            manager = new SessionExportsManager(session, exportsManagerConfig);
            expect(manager.exportsDirectoryPath()).toEqual(path.join(exportsManagerConfig.exportPath, dummySessionId));
        });
    });

    describe("#exportFilePath", function () {
        it("should throw when export name has no extension", function () {
            expect(() => manager.exportFilePath(dummySessionExportPath, "name")).toThrow();
        });

        it("should return path to provided export file", function () {
            expect(manager.exportFilePath(dummySessionExportPath, "mflix.movies.json")).toEqual(
                path.join(dummySessionExportPath, "mflix.movies.json")
            );
        });
    });

    describe("#readExport", function () {
        it("should throw when export name has no extension", async function () {
            await expect(() => manager.readExport("name")).rejects.toThrow();
        });

        it("should return the resource content", async function () {
            const { name, content } = await createDummyExport();
            session.sessionId = dummySessionId;
            manager = new SessionExportsManager(session, exportsManagerConfig);
            expect(await manager.readExport(name)).toEqual(content);
        });
    });

    describe("#createJSONExport", function () {
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

        it.each([
            { cond: "when exportName does not contain extension", exportName: "foo.bar" },
            { cond: "when exportName contains extension", exportName: "foo.bar.json" },
        ])(
            "$cond, should export relaxed json, update available exports and emit export-available event",
            async function ({ exportName }) {
                const emitSpy = vi.spyOn(session, "emit");
                session.sessionId = dummySessionId;
                manager = new SessionExportsManager(session, exportsManagerConfig);
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
                        name: "foo.bar.json",
                        uri: "exported-data://foo.bar.json",
                    })
                );

                // Emit event
                expect(emitSpy).toHaveBeenCalledWith("export-available", "exported-data://foo.bar.json");

                // Exports relaxed json
                const jsonData = JSON.parse(await manager.readExport("foo.bar.json")) as unknown[];
                expect(jsonData).toContainEqual(expect.objectContaining({ name: "foo", longNumber: 12 }));
                expect(jsonData).toContainEqual(expect.objectContaining({ name: "bar", longNumber: 123456 }));
            }
        );

        it.each([
            { cond: "when exportName does not contain extension", exportName: "foo.bar" },
            { cond: "when exportName contains extension", exportName: "foo.bar.json" },
        ])(
            "$cond, should export canonical json, update available exports and emit export-available event",
            async function ({ exportName }) {
                const emitSpy = vi.spyOn(session, "emit");
                session.sessionId = dummySessionId;
                manager = new SessionExportsManager(session, exportsManagerConfig);
                await manager.createJSONExport({
                    input: inputCursor,
                    exportName,
                    jsonExportFormat: "canonical",
                });

                // Updates available export
                const availableExports = manager.listAvailableExports();
                expect(availableExports).toHaveLength(1);
                expect(availableExports).toContainEqual(
                    expect.objectContaining({
                        name: "foo.bar.json",
                        uri: "exported-data://foo.bar.json",
                    })
                );

                // Emit event
                expect(emitSpy).toHaveBeenCalledWith("export-available", "exported-data://foo.bar.json");

                // Exports relaxed json
                const jsonData = JSON.parse(await manager.readExport("foo.bar.json")) as unknown[];
                expect(jsonData).toContainEqual(
                    expect.objectContaining({ name: "foo", longNumber: { $numberLong: "12" } })
                );
                expect(jsonData).toContainEqual(
                    expect.objectContaining({ name: "bar", longNumber: { $numberLong: "123456" } })
                );
            }
        );
    });

    describe("#cleanupExpiredExports", function () {
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

        it("should do nothing if session is not initialized", async function () {
            const { path } = await createDummyExport();
            new SessionExportsManager(session, {
                ...exportsManagerConfig,
                exportTimeoutMs: 100,
                exportCleanupIntervalMs: 50,
            });

            expect(await fileExists(path)).toEqual(true);
            await timeout(200);
            expect(await fileExists(path)).toEqual(true);
        });

        it("should cleanup expired exports if session is initialized", async function () {
            session.sessionId = dummySessionId;
            const manager = new SessionExportsManager(session, {
                ...exportsManagerConfig,
                exportTimeoutMs: 100,
                exportCleanupIntervalMs: 50,
            });
            await manager.createJSONExport({
                input,
                exportName: dummyExportName,
                jsonExportFormat: "relaxed",
            });

            expect(manager.listAvailableExports()).toContainEqual(
                expect.objectContaining({
                    name: "foo.bar.json",
                    uri: "exported-data://foo.bar.json",
                })
            );
            expect(await fileExists(dummyExportPath)).toEqual(true);
            await timeout(200);
            expect(manager.listAvailableExports()).toEqual([]);
            expect(await fileExists(dummyExportPath)).toEqual(false);
        });
    });
});
