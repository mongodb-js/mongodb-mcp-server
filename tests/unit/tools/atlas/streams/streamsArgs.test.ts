import { describe, it, expect } from "vitest";
import {
    ConnectionConfig,
    PrivateLinkConfig,
    StreamsArgs,
} from "../../../../../src/tools/atlas/streams/streamsArgs.js";

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

describe("ConnectionConfig", () => {
    describe("passthrough", () => {
        it("should preserve unknown fields via passthrough", () => {
            const result = ConnectionConfig.parse({ unknownField: "value", bootstrapServers: "b:9092" });
            expect(result.unknownField).toBe("value");
        });
    });

    describe("ConnectionConfig transforms", () => {
        describe("bootstrapServers", () => {
            it("should join an array into a comma-separated string", () => {
                const result = ConnectionConfig.parse({ bootstrapServers: ["b1:9092", "b2:9092"] });
                expect(result.bootstrapServers).toBe("b1:9092,b2:9092");
            });

            it("should unwrap a single-element array", () => {
                const result = ConnectionConfig.parse({ bootstrapServers: ["broker:9092"] });
                expect(result.bootstrapServers).toBe("broker:9092");
            });

            it("should pass through a plain string unchanged", () => {
                const result = ConnectionConfig.parse({ bootstrapServers: "b1:9092,b2:9092" });
                expect(result.bootstrapServers).toBe("b1:9092,b2:9092");
            });
        });

        describe("schemaRegistryUrls", () => {
            it("should split a single string into an array", () => {
                const result = ConnectionConfig.parse({
                    schemaRegistryUrls: "https://sr1:8081,https://sr2:8081",
                });
                expect(result.schemaRegistryUrls).toEqual(["https://sr1:8081", "https://sr2:8081"]);
            });

            it("should split a comma-separated string and trim whitespace", () => {
                const result = ConnectionConfig.parse({
                    schemaRegistryUrls: "https://sr1:8081, https://sr2:8081",
                });
                expect(result.schemaRegistryUrls).toEqual(["https://sr1:8081", "https://sr2:8081"]);
            });

            it("should unwrap a single string into a one-element array", () => {
                const result = ConnectionConfig.parse({ schemaRegistryUrls: "https://sr:8081" });
                expect(result.schemaRegistryUrls).toEqual(["https://sr:8081"]);
            });

            it("should pass through an array unchanged", () => {
                const result = ConnectionConfig.parse({
                    schemaRegistryUrls: ["https://sr1:8081", "https://sr2:8081"],
                });
                expect(result.schemaRegistryUrls).toEqual(["https://sr1:8081", "https://sr2:8081"]);
            });
        });
    });
});

describe("PrivateLinkConfig", () => {
    it("should preserve unknown fields via passthrough", () => {
        const result = PrivateLinkConfig.parse({ provider: "AWS", region: "us-east-1", customField: "custom" });
        expect(result.customField).toBe("custom");
    });

    it("should accept dnsSubDomain as an array of strings", () => {
        const result = PrivateLinkConfig.parse({
            provider: "AWS",
            vendor: "CONFLUENT",
            dnsDomain: "example.com",
            dnsSubDomain: ["zone-a", "zone-b"],
        });
        expect(result.dnsSubDomain).toEqual(["zone-a", "zone-b"]);
    });

    it("should accept dnsSubDomain as an empty array", () => {
        const result = PrivateLinkConfig.parse({
            provider: "AWS",
            vendor: "CONFLUENT",
            dnsDomain: "example.com",
            dnsSubDomain: [],
        });
        expect(result.dnsSubDomain).toEqual([]);
    });

    it("should reject dnsSubDomain as a plain string", () => {
        const result = PrivateLinkConfig.safeParse({
            provider: "AWS",
            vendor: "CONFLUENT",
            dnsSubDomain: "not-an-array",
        });
        expect(result.success).toBe(false);
    });

    it("should accept azureResourceIds", () => {
        const result = PrivateLinkConfig.parse({
            provider: "AZURE",
            vendor: "CONFLUENT",
            dnsDomain: "example.com",
            azureResourceIds: ["/subscriptions/sub1/resourceGroups/rg1"],
        });
        expect(result.azureResourceIds).toEqual(["/subscriptions/sub1/resourceGroups/rg1"]);
    });
});
