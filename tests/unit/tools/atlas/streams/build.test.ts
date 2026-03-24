/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { StreamsBuildTool } from "../../../../../src/tools/atlas/streams/build.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

describe("StreamsBuildTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let mockElicitation: { requestConfirmation: ReturnType<typeof vi.fn>; requestInput: ReturnType<typeof vi.fn> };
    let tool: StreamsBuildTool;

    beforeEach(() => {
        mockApiClient = {
            createStreamWorkspace: vi.fn().mockResolvedValue({}),
            withStreamSampleConnections: vi.fn().mockResolvedValue({}),
            createStreamConnection: vi.fn().mockResolvedValue({}),
            createStreamProcessor: vi.fn().mockResolvedValue({}),
            startStreamProcessor: vi.fn().mockResolvedValue({}),
            createPrivateLinkConnection: vi.fn().mockResolvedValue({}),
            listStreamConnections: vi.fn().mockResolvedValue({ results: [] }),
        };

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        const mockSession = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
        } as unknown as Session;

        const mockConfig = {
            confirmationRequiredTools: [],
            previewFeatures: [],
            disabledTools: [],
            apiClientId: "test-id",
            apiClientSecret: "test-secret",
        } as unknown as UserConfig;

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as Telemetry;

        mockElicitation = {
            requestConfirmation: vi.fn().mockResolvedValue(true),
            requestInput: vi.fn().mockResolvedValue({ accepted: false }),
        };

        const params: ToolConstructorParams = {
            name: StreamsBuildTool.toolName,
            category: "atlas",
            operationType: StreamsBuildTool.operationType,
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation as unknown as Elicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new StreamsBuildTool(params);
    });

    const baseArgs = { projectId: "proj1", workspaceName: "ws1" };
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) => tool["execute"](args as never);

    describe("createWorkspace", () => {
        it("should create workspace with correct provider/region/tier", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "workspace",
                cloudProvider: "AWS",
                region: "VIRGINIA_USA",
                tier: "SP30",
            });

            expect(mockApiClient.withStreamSampleConnections).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1" } },
                body: {
                    name: "ws1",
                    dataProcessRegion: { cloudProvider: "AWS", region: "VIRGINIA_USA" },
                    streamConfig: { tier: "SP30" },
                },
            });
            expect((result.content[0] as { text: string }).text).toContain("ws1");
            expect((result.content[0] as { text: string }).text).toContain("AWS/VIRGINIA_USA");
        });

        it("should default tier to SP10", async () => {
            await exec({
                ...baseArgs,
                resource: "workspace",
                cloudProvider: "AWS",
                region: "VIRGINIA_USA",
            });

            expect(mockApiClient.withStreamSampleConnections).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        streamConfig: { tier: "SP10" },
                    }),
                })
            );
        });

        it("should skip sample data when includeSampleData is false", async () => {
            await exec({
                ...baseArgs,
                resource: "workspace",
                cloudProvider: "AWS",
                region: "VIRGINIA_USA",
                includeSampleData: false,
            });

            expect(mockApiClient.createStreamWorkspace).toHaveBeenCalledOnce();
            expect(mockApiClient.withStreamSampleConnections).not.toHaveBeenCalled();
        });

        it("should throw when cloudProvider is missing", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "workspace",
                    region: "VIRGINIA_USA",
                })
            ).rejects.toThrow("cloudProvider is required");
        });

        it("should throw when region is missing", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "workspace",
                    cloudProvider: "AWS",
                })
            ).rejects.toThrow("region is required");
        });
    });

    describe("createProcessor", () => {
        it("should create processor with pipeline and DLQ config", async () => {
            const pipeline = [
                { $source: { connectionName: "src" } },
                { $merge: { into: { connectionName: "sink", db: "db1", coll: "coll1" } } },
            ];
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }, { name: "sink" }],
            });

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline,
                dlq: { connectionName: "sink", db: "db1", coll: "dlq" },
            });

            expect(mockApiClient.createStreamProcessor).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1", tenantName: "ws1" } },
                body: {
                    name: "proc1",
                    pipeline,
                    options: { dlq: { connectionName: "sink", db: "db1", coll: "dlq" } },
                },
            });
            expect((result.content[0] as { text: string }).text).toContain("proc1");
        });

        it("should throw when processorName is missing", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "processor",
                    pipeline: [{ $source: { connectionName: "src" } }],
                })
            ).rejects.toThrow("processorName is required");
        });

        it("should throw when pipeline is missing", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "processor",
                    processorName: "proc1",
                })
            ).rejects.toThrow("pipeline is required");
        });

        it("should auto-start processor when autoStart is true", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }, { name: "sink" }],
            });

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [
                    { $source: { connectionName: "src" } },
                    { $merge: { into: { connectionName: "sink", db: "db1", coll: "c1" } } },
                ],
                autoStart: true,
            });

            expect(mockApiClient.startStreamProcessor).toHaveBeenCalledOnce();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("created and started");
            expect(text).toContain("Billing");
            expect(text).toContain("stop-processor");
        });
    });

    describe("createConnection", () => {
        it("should create Kafka connection and normalize bootstrapServers array", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "kafka1",
                connectionType: "Kafka",
                connectionConfig: {
                    bootstrapServers: ["broker1:9092", "broker2:9092"],
                    authentication: { mechanism: "PLAIN", username: "user", password: "pass" },
                    security: { protocol: "SASL_SSL" },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        bootstrapServers: "broker1:9092,broker2:9092",
                        name: "kafka1",
                        type: "Kafka",
                    }),
                })
            );
        });

        it("should create Cluster connection and set default dbRoleToExecute", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "cluster1",
                connectionType: "Cluster",
                connectionConfig: {
                    clusterName: "my-cluster",
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        clusterName: "my-cluster",
                        dbRoleToExecute: { role: "readWriteAnyDatabase", type: "BUILT_IN" },
                    }),
                })
            );
        });

        it("should create S3 connection with roleArn in aws config", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "s3-conn",
                connectionType: "S3",
                connectionConfig: {
                    aws: { roleArn: "arn:aws:iam::123456789:role/my-role" },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        aws: expect.objectContaining({ roleArn: "arn:aws:iam::123456789:role/my-role" }),
                        type: "S3",
                    }),
                })
            );
        });

        it("should trigger elicitation when Kafka missing required fields", async () => {
            mockElicitation.requestInput.mockResolvedValue({ accepted: false });

            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "kafka1",
                connectionType: "Kafka",
                connectionConfig: {},
            });

            expect(mockElicitation.requestInput).toHaveBeenCalled();
            expect((result.content[0] as { text: string }).text).toContain("missing");
            expect(mockApiClient.createStreamConnection).not.toHaveBeenCalled();
        });

        it("should accept elicited fields and proceed with creation", async () => {
            mockElicitation.requestInput.mockResolvedValue({
                accepted: true,
                fields: {
                    bootstrapServers: "broker:9092",
                    mechanism: "PLAIN",
                    username: "user",
                    password: "pass",
                    protocol: "SASL_SSL",
                },
            });

            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "kafka1",
                connectionType: "Kafka",
                connectionConfig: {},
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledOnce();
            expect((result.content[0] as { text: string }).text).toContain("kafka1");
        });

        it("should throw when connectionName is missing", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "connection",
                    connectionType: "Kafka",
                })
            ).rejects.toThrow("connectionName is required");
        });

        it("should throw when connectionType is missing", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "connection",
                    connectionName: "conn1",
                })
            ).rejects.toThrow("connectionType is required");
        });

        it("should warn about PENDING state when connection uses PrivateLink", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "s3-pl",
                connectionType: "S3",
                connectionConfig: {
                    aws: { roleArn: "arn:aws:iam::123:role/my-role" },
                    networking: { access: { type: "PRIVATE_LINK", connectionId: "pl-123" } },
                },
            });

            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("PENDING");
            expect(text).toContain("PrivateLink");
        });
    });

    describe("createConnection - Sample", () => {
        it("should create Sample connection with no config", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "sample1",
                connectionType: "Sample",
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ name: "sample1", type: "Sample" }),
                })
            );
        });
    });

    describe("createConnection - Https", () => {
        it("should create Https connection with url", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "https1",
                connectionType: "Https",
                connectionConfig: { url: "https://example.com/api" },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        url: "https://example.com/api",
                        name: "https1",
                        type: "Https",
                    }),
                })
            );
        });

        it("should trigger elicitation when Https url is missing", async () => {
            mockElicitation.requestInput.mockResolvedValue({ accepted: false });

            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "https1",
                connectionType: "Https",
                connectionConfig: {},
            });

            expect(mockElicitation.requestInput).toHaveBeenCalled();
            expect((result.content[0] as { text: string }).text).toContain("missing");
            expect(mockApiClient.createStreamConnection).not.toHaveBeenCalled();
        });
    });

    describe("createConnection - AWSKinesisDataStreams", () => {
        it("should create Kinesis connection with roleArn", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "kinesis1",
                connectionType: "AWSKinesisDataStreams",
                connectionConfig: {
                    aws: { roleArn: "arn:aws:iam::123:role/my-role" },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        aws: expect.objectContaining({ roleArn: "arn:aws:iam::123:role/my-role" }),
                        type: "AWSKinesisDataStreams",
                    }),
                })
            );
        });

        it("should trigger elicitation when roleArn is missing", async () => {
            mockElicitation.requestInput.mockResolvedValue({ accepted: false });

            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "kinesis1",
                connectionType: "AWSKinesisDataStreams",
                connectionConfig: {},
            });

            expect(mockElicitation.requestInput).toHaveBeenCalled();
            expect((result.content[0] as { text: string }).text).toContain("missing");
            expect((result.content[0] as { text: string }).text).toContain("IAM role ARN");
        });
    });

    describe("createConnection - AWSLambda", () => {
        it("should create Lambda connection with roleArn", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "lambda1",
                connectionType: "AWSLambda",
                connectionConfig: {
                    aws: { roleArn: "arn:aws:iam::456:role/lambda-role" },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        aws: expect.objectContaining({ roleArn: "arn:aws:iam::456:role/lambda-role" }),
                        type: "AWSLambda",
                    }),
                })
            );
        });
    });

    describe("createConnection - SchemaRegistry", () => {
        it("should create SchemaRegistry connection with normalized URL and default provider", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "sr1",
                connectionType: "SchemaRegistry",
                connectionConfig: {
                    schemaRegistryUrls: ["https://sr.example.com"],
                    schemaRegistryAuthentication: {
                        type: "USER_INFO",
                        username: "user",
                        password: "pass",
                    },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        type: "SchemaRegistry",
                        provider: "CONFLUENT",
                        schemaRegistryUrls: ["https://sr.example.com"],
                    }),
                })
            );
        });

        it("should normalize single URL string to array", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "sr2",
                connectionType: "SchemaRegistry",
                connectionConfig: {
                    schemaRegistryUrls: "https://sr.example.com",
                    schemaRegistryAuthentication: {
                        type: "USER_INFO",
                        username: "user",
                        password: "pass",
                    },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        schemaRegistryUrls: ["https://sr.example.com"],
                    }),
                })
            );
        });

        it("should normalize alternative key names (url → schemaRegistryUrls)", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "sr3",
                connectionType: "SchemaRegistry",
                connectionConfig: {
                    url: "https://sr.example.com",
                    username: "user",
                    password: "pass",
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        schemaRegistryUrls: ["https://sr.example.com"],
                        schemaRegistryAuthentication: expect.objectContaining({
                            type: "USER_INFO",
                            username: "user",
                            password: "pass",
                        }),
                    }),
                })
            );
        });

        it("should not require username/password when SASL_INHERIT is used", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "sr-sasl",
                connectionType: "SchemaRegistry",
                connectionConfig: {
                    schemaRegistryUrls: ["https://sr.example.com"],
                    schemaRegistryAuthentication: {
                        type: "SASL_INHERIT",
                    },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        type: "SchemaRegistry",
                        schemaRegistryAuthentication: expect.objectContaining({
                            type: "SASL_INHERIT",
                        }),
                    }),
                })
            );
            expect(mockElicitation.requestInput).not.toHaveBeenCalled();
        });

        it("should trigger elicitation when SchemaRegistry URL and auth are missing", async () => {
            mockElicitation.requestInput.mockResolvedValue({ accepted: false });

            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "sr4",
                connectionType: "SchemaRegistry",
                connectionConfig: {},
            });

            expect(mockElicitation.requestInput).toHaveBeenCalled();
            expect((result.content[0] as { text: string }).text).toContain("missing");
        });
    });

    describe("pipeline structural validation", () => {
        it("should return error when first stage is not $source", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [
                    { $match: { status: "active" } },
                    { $merge: { into: { connectionName: "sink", db: "db1", coll: "c1" } } },
                ],
            });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("first stage must be `$source`");
            expect(text).toContain("$match");
            expect(mockApiClient.createStreamProcessor).not.toHaveBeenCalled();
        });

        it("should return error when last stage is not a terminal stage", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [{ $source: { connectionName: "src" } }, { $match: { status: "active" } }],
            });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("last stage must be a terminal stage");
            expect(text).toContain("$match");
            expect(mockApiClient.createStreamProcessor).not.toHaveBeenCalled();
        });

        it("should return error when pipeline contains $$NOW", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [
                    { $source: { connectionName: "src" } },
                    { $addFields: { ts: "$$NOW" } },
                    { $merge: { into: { connectionName: "sink", db: "db1", coll: "c1" } } },
                ],
            });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("$$NOW");
            expect(text).toContain("not available in streaming context");
            expect(mockApiClient.createStreamProcessor).not.toHaveBeenCalled();
        });

        it("should return error when pipeline contains $$ROOT", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [
                    { $source: { connectionName: "src" } },
                    { $replaceRoot: { newRoot: "$$ROOT" } },
                    { $emit: { connectionName: "sink", topic: "out" } },
                ],
            });

            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("$$ROOT");
        });

        it("should accept $emit as a valid terminal stage", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }, { name: "sink" }],
            });

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [{ $source: { connectionName: "src" } }, { $emit: { connectionName: "sink", topic: "out" } }],
            });

            expect(result.isError).toBeUndefined();
            expect(mockApiClient.createStreamProcessor).toHaveBeenCalledOnce();
        });

        it("should accept $https as a valid terminal stage", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }, { name: "webhook" }],
            });

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [{ $source: { connectionName: "src" } }, { $https: { connectionName: "webhook" } }],
            });

            expect(result.isError).toBeUndefined();
            expect(mockApiClient.createStreamProcessor).toHaveBeenCalledOnce();
        });

        it("should accept $externalFunction as a valid terminal stage", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }, { name: "lambda" }],
            });

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [{ $source: { connectionName: "src" } }, { $externalFunction: { connectionName: "lambda" } }],
            });

            expect(result.isError).toBeUndefined();
            expect(mockApiClient.createStreamProcessor).toHaveBeenCalledOnce();
        });
    });

    describe("pipeline connection validation", () => {
        it("should return error when pipeline references non-existent connections", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "existing-conn" }],
            });

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [
                    { $source: { connectionName: "missing-conn" } },
                    { $merge: { into: { connectionName: "existing-conn", db: "db1", coll: "c1" } } },
                ],
            });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("missing-conn");
            expect(text).toContain("do not exist");
        });

        it("should succeed when all pipeline connections exist", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }, { name: "sink" }],
            });

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [
                    { $source: { connectionName: "src" } },
                    { $merge: { into: { connectionName: "sink", db: "db1", coll: "c1" } } },
                ],
            });

            expect(result.isError).toBeUndefined();
            expect(mockApiClient.createStreamProcessor).toHaveBeenCalledOnce();
        });

        it("should return error when DLQ references non-existent connection", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }, { name: "sink" }],
            });

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [
                    { $source: { connectionName: "src" } },
                    { $merge: { into: { connectionName: "sink", db: "db1", coll: "c1" } } },
                ],
                dlq: { connectionName: "missing-dlq-conn", db: "errors", coll: "dlq" },
            });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("missing-dlq-conn");
            expect(text).toContain("do not exist");
        });

        it("should skip validation when connection list API fails", async () => {
            mockApiClient.listStreamConnections!.mockRejectedValue(new Error("API error"));

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [
                    { $source: { connectionName: "src" } },
                    { $merge: { into: { connectionName: "sink", db: "db1", coll: "c1" } } },
                ],
            });

            expect(result.isError).toBeUndefined();
            expect(mockApiClient.createStreamProcessor).toHaveBeenCalledOnce();
        });
    });

    describe("createPrivateLink", () => {
        it("should create AWS CONFLUENT PrivateLink with correct params", async () => {
            await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "AWS",
                    region: "us-east-1",
                    vendor: "CONFLUENT",
                    serviceEndpointId: "com.amazonaws.vpce.us-east-1.vpce-svc-abc123",
                    dnsDomain: "example.com",
                    dnsSubDomain: ["sub"],
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1" } },
                body: {
                    provider: "AWS",
                    region: "us-east-1",
                    vendor: "CONFLUENT",
                    serviceEndpointId: "com.amazonaws.vpce.us-east-1.vpce-svc-abc123",
                    dnsDomain: "example.com",
                    dnsSubDomain: ["sub"],
                },
            });
        });

        it("should create AWS S3 PrivateLink", async () => {
            await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "AWS",
                    region: "us-east-1",
                    vendor: "S3",
                    serviceEndpointId: "com.amazonaws.us-east-1.s3",
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1" } },
                body: {
                    provider: "AWS",
                    region: "us-east-1",
                    vendor: "S3",
                    serviceEndpointId: "com.amazonaws.us-east-1.s3",
                },
            });
        });

        it("should create AWS MSK PrivateLink", async () => {
            await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "AWS",
                    vendor: "MSK",
                    arn: "arn:aws:kafka:us-east-1:123456789012:cluster/my-msk/abc-123",
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1" } },
                body: {
                    provider: "AWS",
                    vendor: "MSK",
                    arn: "arn:aws:kafka:us-east-1:123456789012:cluster/my-msk/abc-123",
                },
            });
        });

        it("should create AWS KINESIS PrivateLink", async () => {
            await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "AWS",
                    region: "us-east-1",
                    vendor: "KINESIS",
                    serviceEndpointId: "com.amazonaws.vpce.us-east-1.vpce-svc-abc123",
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1" } },
                body: {
                    provider: "AWS",
                    region: "us-east-1",
                    vendor: "KINESIS",
                    serviceEndpointId: "com.amazonaws.vpce.us-east-1.vpce-svc-abc123",
                },
            });
        });

        it("should create AZURE EVENTHUB PrivateLink", async () => {
            await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "AZURE",
                    vendor: "EVENTHUB",
                    region: "eastus2",
                    dnsDomain: "mynamespace.servicebus.windows.net",
                    serviceEndpointId:
                        "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.EventHub/namespaces/mynamespace",
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1" } },
                body: {
                    provider: "AZURE",
                    vendor: "EVENTHUB",
                    region: "eastus2",
                    dnsDomain: "mynamespace.servicebus.windows.net",
                    serviceEndpointId:
                        "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.EventHub/namespaces/mynamespace",
                },
            });
        });

        it("should create AZURE CONFLUENT PrivateLink", async () => {
            await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "AZURE",
                    vendor: "CONFLUENT",
                    region: "eastus2",
                    dnsDomain: "pkc-abc123.eastus2.azure.confluent.cloud",
                    azureResourceIds: ["/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Confluent/abc"],
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1" } },
                body: {
                    provider: "AZURE",
                    vendor: "CONFLUENT",
                    region: "eastus2",
                    dnsDomain: "pkc-abc123.eastus2.azure.confluent.cloud",
                    azureResourceIds: ["/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Confluent/abc"],
                },
            });
        });

        it("should create GCP CONFLUENT PrivateLink", async () => {
            await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "GCP",
                    vendor: "CONFLUENT",
                    region: "us-central1",
                    dnsDomain: "pkc-abc123.us-central1.gcp.confluent.cloud",
                    gcpServiceAttachmentUris: ["projects/p1/regions/us-central1/serviceAttachments/att-1"],
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1" } },
                body: {
                    provider: "GCP",
                    vendor: "CONFLUENT",
                    region: "us-central1",
                    dnsDomain: "pkc-abc123.us-central1.gcp.confluent.cloud",
                    gcpServiceAttachmentUris: ["projects/p1/regions/us-central1/serviceAttachments/att-1"],
                },
            });
        });

        it("should throw when privateLinkConfig is missing", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "privatelink",
                })
            ).rejects.toThrow("privateLinkConfig is required");
        });

        it("should throw when privateLinkConfig.provider is missing", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "privatelink",
                    privateLinkConfig: { region: "us-east-1" },
                })
            ).rejects.toThrow("privateLinkConfig.provider is required");
        });
    });
});
