import { describe, it, expect } from "vitest";
import { StreamsArgs } from "../../../../../src/tools/atlas/streams/streamsArgs.js";

describe("StreamsArgs", () => {
    describe("workspaceName", () => {
        const schema = StreamsArgs.workspaceName();

        it("should accept valid names", () => {
            expect(schema.safeParse("my-workspace").success).toBe(true);
            expect(schema.safeParse("ws_123").success).toBe(true);
            expect(schema.safeParse("A").success).toBe(true);
            expect(schema.safeParse("a".repeat(64)).success).toBe(true);
        });

        it("should reject empty string", () => {
            expect(schema.safeParse("").success).toBe(false);
        });

        it("should reject names longer than 64 characters", () => {
            expect(schema.safeParse("a".repeat(65)).success).toBe(false);
        });

        it("should reject names with special characters", () => {
            expect(schema.safeParse("my workspace!").success).toBe(false);
            expect(schema.safeParse("ws@name").success).toBe(false);
            expect(schema.safeParse("ws.name").success).toBe(false);
        });
    });

    describe("processorName", () => {
        const schema = StreamsArgs.processorName();

        it("should accept valid names", () => {
            expect(schema.safeParse("my-processor").success).toBe(true);
            expect(schema.safeParse("proc_1").success).toBe(true);
        });

        it("should reject empty string", () => {
            expect(schema.safeParse("").success).toBe(false);
        });

        it("should reject names with spaces", () => {
            expect(schema.safeParse("my processor").success).toBe(false);
        });
    });

    describe("connectionName", () => {
        const schema = StreamsArgs.connectionName();

        it("should accept valid names", () => {
            expect(schema.safeParse("kafka-conn").success).toBe(true);
            expect(schema.safeParse("conn_1").success).toBe(true);
        });

        it("should reject empty string", () => {
            expect(schema.safeParse("").success).toBe(false);
        });

        it("should reject names longer than 64 characters", () => {
            expect(schema.safeParse("c".repeat(65)).success).toBe(false);
        });
    });
});
