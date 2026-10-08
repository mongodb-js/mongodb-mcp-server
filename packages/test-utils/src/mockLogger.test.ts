import { describe, it, expect } from "vitest";
import { LogId } from "@mongodb-js/mcp-core";
import { createMockLogger } from "./mockLogger.js";

describe("createMockLogger", () => {
    it("exposes every method as a mock", async () => {
        const logger = createMockLogger();
        expect(logger.info).toBeTypeOf("function");
        logger.info({ id: LogId.serverInitialized, context: "test", message: "hello" });
        expect(logger.info).toHaveBeenCalled();
        await expect(logger.flush()).resolves.toEqual([]);
    });

    it("asCompositeLogger() satisfies the ICompositeLogger contract without mutation", () => {
        const logger = createMockLogger();
        let logged: string | undefined;
        logger.info.mockImplementation((payload: { message: string }) => {
            logged = payload.message;
        });
        const composite = logger.asCompositeLogger();
        composite.info({ id: LogId.serverInitialized, context: "test", message: "world" });
        expect(logged).toBe("world");
    });

    it("allLogMessages() concatenates every emitted log message", () => {
        const logger = createMockLogger();
        logger.info({ id: LogId.serverInitialized, context: "test", message: "foo" });
        logger.warning({ id: LogId.serverInitialized, context: "test", message: "bar" });
        logger.debug({ id: LogId.serverInitialized, context: "test", message: "baz" });
        const all = logger.allLogMessages();
        expect(all).toContain("foo");
        expect(all).toContain("bar");
        expect(all).toContain("baz");
    });

    it("allLogMessages() is empty when nothing was logged", () => {
        const logger = createMockLogger();
        expect(logger.allLogMessages().trim()).toBe("");
    });

    it("allLogMessages() reflects mocked-out calls after they are recorded", () => {
        const logger = createMockLogger();
        logger.error({ id: LogId.serverInitialized, context: "test", message: "s3cret" });
        expect(logger.allLogMessages()).toContain("s3cret");
    });
});
