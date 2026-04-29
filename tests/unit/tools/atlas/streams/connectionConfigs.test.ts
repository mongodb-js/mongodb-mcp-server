import { describe, it, expect } from "vitest";
import {
    KafkaConnectionConfig,
    ClusterConnectionConfig,
    S3ConnectionConfig,
    KinesisConnectionConfig,
    LambdaConnectionConfig,
    HttpsConnectionConfig,
    SchemaRegistryConnectionConfig,
    PrivateLinkConnectionConfig,
    getConnectionConfigSchema,
} from "../../../../../src/tools/atlas/streams/connectionConfigs.js";

describe("per-type connection config schemas", () => {
    describe("KafkaConnectionConfig", () => {
        it("accepts a minimal Kafka config with bootstrapServers", () => {
            const result = KafkaConnectionConfig.safeParse({
                bootstrapServers: "broker1:9092,broker2:9092",
            });
            expect(result.success).toBe(true);
        });

        it("rejects Kafka config with Cluster-only field clusterName", () => {
            const result = KafkaConnectionConfig.safeParse({
                bootstrapServers: "broker1:9092",
                clusterName: "my-cluster",
            });
            expect(result.success).toBe(false);
        });

        it("rejects Kafka config with Https-only field url", () => {
            const result = KafkaConnectionConfig.safeParse({
                bootstrapServers: "broker1:9092",
                url: "https://webhook.example.com",
            });
            expect(result.success).toBe(false);
        });

        it("accepts Kafka config with authentication and security sub-objects", () => {
            const result = KafkaConnectionConfig.safeParse({
                bootstrapServers: "broker1:9092",
                authentication: { mechanism: "PLAIN", username: "u", password: "p" },
                security: { protocol: "SASL_SSL" },
            });
            expect(result.success).toBe(true);
        });
    });

    describe("ClusterConnectionConfig", () => {
        it("accepts a minimal Cluster config with clusterName", () => {
            const result = ClusterConnectionConfig.safeParse({ clusterName: "my-cluster" });
            expect(result.success).toBe(true);
        });

        it("rejects Cluster config with Kafka-only field bootstrapServers", () => {
            const result = ClusterConnectionConfig.safeParse({
                clusterName: "my-cluster",
                bootstrapServers: "broker1:9092",
            });
            expect(result.success).toBe(false);
        });

        it("accepts optional dbRoleToExecute", () => {
            const result = ClusterConnectionConfig.safeParse({
                clusterName: "my-cluster",
                dbRoleToExecute: { role: "readWriteAnyDatabase", type: "BUILT_IN" },
            });
            expect(result.success).toBe(true);
        });
    });

    describe("S3ConnectionConfig", () => {
        it("accepts a minimal S3 config with aws.roleArn", () => {
            const result = S3ConnectionConfig.safeParse({
                aws: { roleArn: "arn:aws:iam::123:role/r" },
            });
            expect(result.success).toBe(true);
        });

        it("rejects S3 config with Kafka-only field bootstrapServers", () => {
            const result = S3ConnectionConfig.safeParse({
                aws: { roleArn: "arn:aws:iam::123:role/r" },
                bootstrapServers: "broker1:9092",
            });
            expect(result.success).toBe(false);
        });
    });

    describe("KinesisConnectionConfig", () => {
        it("accepts a minimal Kinesis config with aws.roleArn", () => {
            const result = KinesisConnectionConfig.safeParse({
                aws: { roleArn: "arn:aws:iam::123:role/r" },
            });
            expect(result.success).toBe(true);
        });

        it("rejects Kinesis config with Cluster-only field clusterName", () => {
            const result = KinesisConnectionConfig.safeParse({
                aws: { roleArn: "arn:aws:iam::123:role/r" },
                clusterName: "my-cluster",
            });
            expect(result.success).toBe(false);
        });
    });

    describe("LambdaConnectionConfig", () => {
        it("accepts a minimal Lambda config with aws.roleArn", () => {
            const result = LambdaConnectionConfig.safeParse({
                aws: { roleArn: "arn:aws:iam::123:role/r" },
            });
            expect(result.success).toBe(true);
        });

        it("rejects Lambda config with Https-only field url", () => {
            const result = LambdaConnectionConfig.safeParse({
                aws: { roleArn: "arn:aws:iam::123:role/r" },
                url: "https://webhook.example.com",
            });
            expect(result.success).toBe(false);
        });
    });

    describe("HttpsConnectionConfig", () => {
        it("accepts a minimal Https config with url", () => {
            const result = HttpsConnectionConfig.safeParse({ url: "https://webhook.example.com" });
            expect(result.success).toBe(true);
        });

        it("rejects Https config with Kafka-only field bootstrapServers", () => {
            const result = HttpsConnectionConfig.safeParse({
                url: "https://webhook.example.com",
                bootstrapServers: "broker1:9092",
            });
            expect(result.success).toBe(false);
        });

        it("accepts Https config with headers", () => {
            const result = HttpsConnectionConfig.safeParse({
                url: "https://webhook.example.com",
                headers: { "x-api-key": "abc" },
            });
            expect(result.success).toBe(true);
        });
    });

    describe("SchemaRegistryConnectionConfig", () => {
        it("accepts a minimal SchemaRegistry config with URLs and auth", () => {
            const result = SchemaRegistryConnectionConfig.safeParse({
                provider: "CONFLUENT",
                schemaRegistryUrls: ["https://sr.example.com"],
                schemaRegistryAuthentication: { type: "USER_INFO", username: "u", password: "p" },
            });
            expect(result.success).toBe(true);
        });

        it("rejects SchemaRegistry config with Kafka-only field bootstrapServers", () => {
            const result = SchemaRegistryConnectionConfig.safeParse({
                schemaRegistryUrls: ["https://sr.example.com"],
                bootstrapServers: "broker1:9092",
            });
            expect(result.success).toBe(false);
        });
    });

    describe("PrivateLinkConnectionConfig", () => {
        it("accepts AWS PrivateLink with required fields", () => {
            const result = PrivateLinkConnectionConfig.safeParse({
                provider: "AWS",
                region: "us-east-1",
                vendor: "CONFLUENT",
                serviceEndpointId: "com.amazonaws.vpce.us-east-1.vpce-svc-xyz",
                dnsDomain: "example.confluent.cloud",
                dnsSubDomain: [],
            });
            expect(result.success).toBe(true);
        });

        it("rejects PrivateLink config without provider", () => {
            const result = PrivateLinkConnectionConfig.safeParse({ region: "us-east-1" });
            expect(result.success).toBe(false);
        });
    });

    describe("getConnectionConfigSchema", () => {
        it("returns KafkaConnectionConfig for 'Kafka'", () => {
            expect(getConnectionConfigSchema("Kafka")).toBe(KafkaConnectionConfig);
        });

        it("returns ClusterConnectionConfig for 'Cluster'", () => {
            expect(getConnectionConfigSchema("Cluster")).toBe(ClusterConnectionConfig);
        });

        it("returns S3ConnectionConfig for 'S3'", () => {
            expect(getConnectionConfigSchema("S3")).toBe(S3ConnectionConfig);
        });

        it("returns KinesisConnectionConfig for 'AWSKinesisDataStreams'", () => {
            expect(getConnectionConfigSchema("AWSKinesisDataStreams")).toBe(KinesisConnectionConfig);
        });

        it("returns LambdaConnectionConfig for 'AWSLambda'", () => {
            expect(getConnectionConfigSchema("AWSLambda")).toBe(LambdaConnectionConfig);
        });

        it("returns HttpsConnectionConfig for 'Https'", () => {
            expect(getConnectionConfigSchema("Https")).toBe(HttpsConnectionConfig);
        });

        it("returns SchemaRegistryConnectionConfig for 'SchemaRegistry'", () => {
            expect(getConnectionConfigSchema("SchemaRegistry")).toBe(SchemaRegistryConnectionConfig);
        });

        it("returns null for 'Sample' (no config fields to validate)", () => {
            expect(getConnectionConfigSchema("Sample")).toBeNull();
        });

        it("returns null for an unknown connection type", () => {
            expect(getConnectionConfigSchema("totally-made-up")).toBeNull();
        });
    });
});
