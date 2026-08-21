import { describe, afterEach, beforeEach, vi, it, expect } from "vitest";
import type { LogLevel, LogWriter, MongoDBLogLevel } from "@mongodb-js/mcp-types";
import { Keychain, LogId } from "@mongodb-js/mcp-core";
import { DiskLogger } from "./diskLogger.js";

type LogWriterCall = {
    level: MongoDBLogLevel;
    component: string;
    id: { __value: number };
    context: string;
    message: string;
    attributes?: unknown;
};

const createMockLogWriter = (): { writer: LogWriter; calls: LogWriterCall[]; flushMock: ReturnType<typeof vi.fn> } => {
    const calls: LogWriterCall[] = [];
    const writer = {} as LogWriter;
    const flushMock = vi.fn().mockResolvedValue(undefined);

    for (const level of ["info", "warn", "error", "debug", "fatal"] as MongoDBLogLevel[]) {
        writer[level] = vi.fn(
            (component: string, id: { __value: number }, context: string, message: string, attributes?: unknown) => {
                calls.push({ level, component, id, context, message, attributes });
            }
        );
    }
    writer.flush = flushMock;

    return { writer, calls, flushMock };
};

describe("DiskLogger", () => {
    let keychain: Keychain;
    let mock: ReturnType<typeof createMockLogWriter>;
    let diskLogger: DiskLogger;

    beforeEach(() => {
        keychain = Keychain.root;
        mock = createMockLogWriter();
        diskLogger = new DiskLogger({ logWriter: mock.writer, keychain });
    });

    afterEach(() => {
        keychain.clearAllSecrets();
        vi.restoreAllMocks();
    });

    describe("log level mapping", () => {
        const cases: Array<[LogLevel, MongoDBLogLevel]> = [
            ["info", "info"],
            ["warning", "warn"],
            ["error", "error"],
            ["notice", "debug"],
            ["debug", "debug"],
            ["critical", "fatal"],
            ["alert", "fatal"],
            ["emergency", "fatal"],
        ];

        it.each(cases)("maps %s to the MongoDB log level %s", (level, expectedLevel) => {
            diskLogger.log(level, {
                id: LogId.serverInitialized,
                context: "test",
                message: "Test message",
            });

            expect(mock.calls).toHaveLength(1);
            expect(mock.calls[0]?.level).toBe(expectedLevel);
        });
    });

    it("delegates the log entry to the underlying log writer", () => {
        diskLogger.error({
            id: LogId.serverInitialized,
            context: "test",
            message: "Test message",
            attributes: { foo: "bar" },
        });

        expect(mock.calls).toHaveLength(1);
        expect(mock.calls[0]).toMatchObject({
            level: "error",
            component: "MONGODB-MCP",
            id: LogId.serverInitialized,
            context: "test",
            message: "Test message",
            attributes: { foo: "bar" },
        });
    });

    it("redacts sensitive information by default", () => {
        keychain.register("SuperSecretPass123", "password");
        diskLogger.info({
            id: LogId.serverInitialized,
            context: "test",
            message: 'Failed to connect: "mongodb://admin:SuperSecretPass123@/db"',
        });

        expect(mock.calls[0]?.message).not.toContain("SuperSecretPass123");
    });

    it("delegates flush to the underlying log writer", async () => {
        const results = await diskLogger.flush();

        expect(mock.flushMock).toHaveBeenCalledOnce();
        expect(results[0]?.status).toBe("fulfilled");
    });
});
