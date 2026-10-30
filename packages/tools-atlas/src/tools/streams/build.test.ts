/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { IAtlasConfig } from "@mongodb-js/mcp-tools-atlas";
import { ConnectionConfig, PrivateLinkConfig, StreamsBuildTool } from "@mongodb-js/mcp-tools-atlas";
import type { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import type { Elicitation } from "@mongodb-js/mcp-core";
import { Keychain } from "@mongodb-js/mcp-core";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { CallToolResult } from "@mongodb-js/mcp-types";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";
import type { AtlasToolServer } from "../../atlasTool.js";

describe("StreamsBuildTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let mockElicitation: {
        supportsElicitation: ReturnType<typeof vi.fn>;
        readInput: ReturnType<typeof vi.fn>;
        inputRequired: ReturnType<typeof vi.fn>;
        readConfirmation: ReturnType<typeof vi.fn>;
        confirmationRequired: ReturnType<typeof vi.fn>;
    };
    let tool: StreamsBuildTool;
    let server: AtlasToolServer;

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
            config: {
                confirmationRequiredTools: [],
                previewFeatures: [],
                disabledTools: [],
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
                atlasTemporaryDatabaseUserLifetimeMs: 3600000,
            } as unknown as IAtlasConfig,
        } as unknown as AtlasToolServer;

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as AtlasTelemetry;

        mockElicitation = {
            supportsElicitation: vi.fn().mockReturnValue(true),
            // Default: no inputResponses yet -> the tool returns inputRequired.
            readInput: vi.fn().mockReturnValue(undefined),
            inputRequired: vi.fn().mockImplementation(({ key, message }: { key: string; message: string }) => ({
                resultType: "input_required",
                inputRequests: { [key]: { method: "elicitation/create", params: { message } } },
            })),
            readConfirmation: vi.fn().mockReturnValue(undefined),
            confirmationRequired: vi.fn(),
        };

        server = {
            ...mockSession,
            keychain: new Keychain(),
            telemetry: mockTelemetry,
            elicitation: mockElicitation as unknown as Elicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new StreamsBuildTool({ server });
    });

    const baseArgs = { projectId: "proj1", workspaceName: "ws1" };
    // Most tests exercise the happy path and narrow the result to
    // CallToolResult; elicitation tests assert `resultType === "input_required"`.
    const exec = async (args: Record<string, unknown>): Promise<CallToolResult> =>
        (await tool["execute"](args as never, {
            request: {
                signal: new AbortController().signal,
            },
        })) as CallToolResult;

    describe("createWorkspace", () => {
        it("should create workspace with correct provider/region/tier", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "workspace",
                cloudProvider: "AWS",
                region: "VIRGINIA_USA",
                tier: "SP30",
            });

            expect(mockApiClient.withStreamSampleConnections).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        name: "ws1",
                        dataProcessRegion: { cloudProvider: "AWS", region: "VIRGINIA_USA" },
                        streamConfig: { tier: "SP30" },
                    },
                },
                expect.anything()
            );
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
                }),
                expect.anything()
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

            expect(mockApiClient.createStreamProcessor).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1", tenantName: "ws1" } },
                    body: {
                        name: "proc1",
                        pipeline,
                        options: { dlq: { connectionName: "sink", db: "db1", coll: "dlq" } },
                    },
                },
                expect.anything()
            );
            expect((result.content[0] as { text: string }).text).toContain("proc1");
            expect(result.structuredContent).toEqual({
                resource: "processor",
            });
        });

        it("should create a processor with a baseline tier and autoscaling", async () => {
            const pipeline = [
                { $source: { connectionName: "src" } },
                { $merge: { into: { connectionName: "sink", db: "db1", coll: "coll1" } } },
            ];
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }, { name: "sink" }],
            });

            await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline,
                processorTier: "SP10",
                autoscaling: { enabled: true, minTier: "SP5", maxTier: "SP30" },
            });

            expect(mockApiClient.createStreamProcessor).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: {
                        name: "proc1",
                        pipeline,
                        tier: "SP10",
                        options: { autoscaling: { enabled: true, minTier: "SP5", maxTier: "SP30" } },
                    },
                }),
                expect.anything()
            );
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
            expect(result.structuredContent).toEqual({
                resource: "processor",
            });
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
                }),
                expect.anything()
            );
        });

        it("should create an MSK IAM Kafka connection without SASL credentials", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "msk-iam",
                connectionType: "Kafka",
                connectionConfig: {
                    bootstrapServers: "broker1:9098",
                    authentication: {
                        mechanism: "AWS_MSK_IAM",
                        aws: { roleArn: "arn:aws:iam::123456789012:role/msk-access" },
                    },
                    security: { protocol: "SASL_SSL" },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        authentication: {
                            mechanism: "AWS_MSK_IAM",
                            aws: { roleArn: "arn:aws:iam::123456789012:role/msk-access" },
                        },
                    }),
                }),
                expect.anything()
            );
        });

        it("should strip SASL credentials from an MSK IAM Kafka connection", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "msk-iam",
                connectionType: "Kafka",
                connectionConfig: {
                    bootstrapServers: "broker1:9098",
                    authentication: {
                        mechanism: "AWS_MSK_IAM",
                        username: "unneeded-user",
                        password: "unneeded-secret",
                        aws: { roleArn: "arn:aws:iam::123456789012:role/msk-access" },
                    },
                    security: { protocol: "SASL_SSL" },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        authentication: {
                            mechanism: "AWS_MSK_IAM",
                            aws: { roleArn: "arn:aws:iam::123456789012:role/msk-access" },
                        },
                    }),
                }),
                expect.anything()
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
                }),
                expect.anything()
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
                }),
                expect.anything()
            );
        });

        it("should return inputRequired when Kafka missing required fields (first entry)", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "kafka1",
                connectionType: "Kafka",
                connectionConfig: {},
            });

            expect(mockElicitation.readInput).toHaveBeenCalledWith(undefined, "connection-fields");
            expect(mockElicitation.inputRequired).toHaveBeenCalled();
            expect(result.resultType).toBe("input_required");
            expect(mockApiClient.createStreamConnection).not.toHaveBeenCalled();
        });

        it("should report missing fields when the user declines to answer", async () => {
            const args = {
                ...baseArgs,
                resource: "connection" as const,
                connectionName: "kafka1",
                connectionType: "Kafka" as const,
                connectionConfig: {},
            };
            mockElicitation.supportsElicitation.mockReturnValue(false);
            const expectedResult = await exec(args);
            mockElicitation.supportsElicitation.mockReturnValue(true);
            mockElicitation.readInput.mockReturnValue({ accepted: false });
            const observe = vi.spyOn(server.metrics.get("toolExecutionDuration"), "observe");
            const emitEvents = vi.spyOn(server.telemetry, "emitEvents");
            const errorLog = vi.spyOn(server.logger, "error");

            const result = await tool.invoke(args, { request: { signal: new AbortController().signal } });

            expect(result).toEqual(expectedResult);
            expect(mockElicitation.inputRequired).not.toHaveBeenCalled();
            expect(observe).toHaveBeenCalledExactlyOnceWith(
                {
                    tool_name: "atlas-streams-build",
                    category: "atlas",
                    status: "declined",
                    operation_type: "create",
                },
                expect.any(Number)
            );
            await vi.waitFor(() => {
                expect(emitEvents.mock.lastCall?.[0]).toMatchObject([
                    { properties: { command: "atlas-streams-build", result: "declined" } },
                ]);
            });
            expect(errorLog).not.toHaveBeenCalled();
            expect(mockApiClient.createStreamConnection).not.toHaveBeenCalled();
        });

        it("records missing fields without elicitation support as a failure", async () => {
            mockElicitation.supportsElicitation.mockReturnValue(false);
            const observe = vi.spyOn(server.metrics.get("toolExecutionDuration"), "observe");
            const emitEvents = vi.spyOn(server.telemetry, "emitEvents");

            const result = await tool.invoke(
                {
                    ...baseArgs,
                    resource: "connection",
                    connectionName: "kafka1",
                    connectionType: "Kafka",
                    connectionConfig: {},
                },
                { request: { signal: new AbortController().signal } }
            );

            expect(result.isError).toBe(true);
            expect(observe.mock.lastCall?.[0]).toMatchObject({ status: "error" });
            await vi.waitFor(() => {
                expect(emitEvents.mock.lastCall?.[0]).toMatchObject([{ properties: { result: "failure" } }]);
            });
            expect(mockApiClient.createStreamConnection).not.toHaveBeenCalled();
        });

        it("should accept elicited fields on re-entry and proceed with creation", async () => {
            mockElicitation.readInput.mockReturnValue({
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

        it("should elicit an IAM role after AWS_MSK_IAM is selected", async () => {
            // Round 1: the user selects the mechanism (MSK IAM) along with
            // bootstrapServers and protocol; re-validation then asks for the
            // IAM role ARN that AWS_MSK_IAM requires instead of SASL credentials.
            mockElicitation.readInput.mockReturnValueOnce({
                accepted: true,
                fields: {
                    bootstrapServers: "broker:9098",
                    mechanism: "AWS_MSK_IAM",
                    protocol: "SASL_SSL",
                },
            });

            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "msk-iam",
                connectionType: "Kafka",
                connectionConfig: {},
            });

            expect(result.resultType).toBe("input_required");
            const roleElicitationParams = mockElicitation.inputRequired.mock.calls[0]?.[0] as {
                schema: { required: string[]; properties: Record<string, unknown> };
            };
            expect(roleElicitationParams.schema.properties).toEqual({ roleArn: expect.any(Object) });
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
            expect(result.structuredContent).toEqual({
                resource: "connection",
            });
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
                }),
                expect.anything()
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
                }),
                expect.anything()
            );
        });

        it("should trigger elicitation when Https url is missing", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "https1",
                connectionType: "Https",
                connectionConfig: {},
            });

            expect(mockElicitation.readInput).toHaveBeenCalled();
            expect(result.resultType).toBe("input_required");
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
                }),
                expect.anything()
            );
        });

        it("should trigger elicitation when roleArn is missing", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "kinesis1",
                connectionType: "AWSKinesisDataStreams",
                connectionConfig: {},
            });

            expect(mockElicitation.readInput).toHaveBeenCalled();
            expect(result.resultType).toBe("input_required");
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
                }),
                expect.anything()
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
                }),
                expect.anything()
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
                }),
                expect.anything()
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
                }),
                expect.anything()
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
                }),
                expect.anything()
            );
            expect(mockElicitation.readInput).not.toHaveBeenCalled();
            expect(mockElicitation.inputRequired).not.toHaveBeenCalled();
        });

        it("should trigger elicitation when SchemaRegistry URL and auth are missing", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "sr4",
                connectionType: "SchemaRegistry",
                connectionConfig: {},
            });

            expect(mockElicitation.readInput).toHaveBeenCalled();
            expect(result.resultType).toBe("input_required");
        });
    });

    describe("createConnection - GCPPubSub", () => {
        it("should create a GCP Pub/Sub connection with serviceAccountId", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "pubsub-out",
                connectionType: "GCPPubSub",
                connectionConfig: {
                    gcp: { serviceAccountId: "atlas-streams@my-project.iam.gserviceaccount.com" },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        name: "pubsub-out",
                        type: "GCPPubSub",
                        gcp: { serviceAccountId: "atlas-streams@my-project.iam.gserviceaccount.com" },
                    }),
                }),
                expect.anything()
            );
        });

        it("should create a GCP Pub/Sub connection with PrivateLink networking", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "pubsub-out",
                connectionType: "GCPPubSub",
                connectionConfig: {
                    gcp: { serviceAccountId: "atlas-streams@my-project.iam.gserviceaccount.com" },
                    publicPrivateNetworking: {
                        access: { type: "PRIVATE_LINK", connectionId: "64b7e9f1a2c3d4e5f6a7b8c9" },
                    },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        type: "GCPPubSub",
                        publicPrivateNetworking: {
                            access: { type: "PRIVATE_LINK", connectionId: "64b7e9f1a2c3d4e5f6a7b8c9" },
                        },
                    }),
                }),
                expect.anything()
            );

            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("PENDING");
        });

        it("should trigger elicitation when serviceAccountId is missing", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "pubsub-out",
                connectionType: "GCPPubSub",
                connectionConfig: {},
            });

            const request = mockElicitation.inputRequired.mock.calls[0]![0] as { schema: { required: string[] } };
            expect(result.resultType).toBe("input_required");
            expect(request.schema.required).toEqual(["serviceAccountId"]);
        });

        it("should require connectionId when access type is PRIVATE_LINK", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "pubsub-out",
                connectionType: "GCPPubSub",
                connectionConfig: {
                    gcp: { serviceAccountId: "atlas-streams@my-project.iam.gserviceaccount.com" },
                    publicPrivateNetworking: { access: { type: "PRIVATE_LINK" } },
                },
            });

            const request = mockElicitation.inputRequired.mock.calls[0]![0] as { schema: { required: string[] } };
            expect(result.resultType).toBe("input_required");
            expect(request.schema.required).toEqual(["connectionId"]);
        });
    });

    describe("createConnection - AzureBlobStorage", () => {
        it("should create an Azure Blob Storage connection with service principal and storage account", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "blob-out",
                connectionType: "AzureBlobStorage",
                connectionConfig: {
                    azure: {
                        servicePrincipalId: "11111111-2222-3333-4444-555555555555",
                        storageAccountName: "acmestorage",
                    },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        name: "blob-out",
                        type: "AzureBlobStorage",
                        azure: {
                            servicePrincipalId: "11111111-2222-3333-4444-555555555555",
                            storageAccountName: "acmestorage",
                        },
                    }),
                }),
                expect.anything()
            );
        });

        it("should lowercase the storageAccountName", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "blob-out",
                connectionType: "AzureBlobStorage",
                connectionConfig: {
                    azure: {
                        servicePrincipalId: "11111111-2222-3333-4444-555555555555",
                        storageAccountName: "AcmeStorage",
                    },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        azure: expect.objectContaining({ storageAccountName: "acmestorage" }),
                    }),
                }),
                expect.anything()
            );
        });

        it("should create an Azure Blob Storage connection with PrivateLink networking", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "blob-out",
                connectionType: "AzureBlobStorage",
                connectionConfig: {
                    azure: {
                        servicePrincipalId: "11111111-2222-3333-4444-555555555555",
                        storageAccountName: "acmestorage",
                    },
                    publicPrivateNetworking: {
                        access: { type: "PRIVATE_LINK", connectionId: "64b7e9f1a2c3d4e5f6a7b8c9" },
                    },
                },
            });

            expect(mockApiClient.createStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        type: "AzureBlobStorage",
                        publicPrivateNetworking: {
                            access: { type: "PRIVATE_LINK", connectionId: "64b7e9f1a2c3d4e5f6a7b8c9" },
                        },
                    }),
                }),
                expect.anything()
            );

            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("PENDING");
        });

        it("should trigger elicitation when Azure config is missing", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "blob-out",
                connectionType: "AzureBlobStorage",
                connectionConfig: {},
            });

            const request = mockElicitation.inputRequired.mock.calls[0]![0] as { schema: { required: string[] } };
            expect(result.resultType).toBe("input_required");
            expect(request.schema.required).toEqual(["servicePrincipalId", "storageAccountName"]);
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

        it("should not reject pipelines whose last stage is not a known sink (API decides)", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }],
            });

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [{ $source: { connectionName: "src" } }, { $match: { status: "active" } }],
            });

            expect(result.isError).toBeUndefined();
            expect(mockApiClient.createStreamProcessor).toHaveBeenCalledOnce();
        });

        it("should accept $iceberg as the last stage", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }, { name: "s3" }],
            });

            const pipeline = [
                { $source: { connectionName: "src" } },
                {
                    $iceberg: {
                        connectionName: "s3",
                        bucket: "myBucket",
                        databaseName: "myDb",
                        tableName: "myTable",
                        path: "iceberg-warehouse",
                    },
                },
            ];

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline,
            });

            expect(result.isError).toBeUndefined();
            expect(mockApiClient.createStreamProcessor).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: { name: "proc1", pipeline },
                }),
                expect.anything()
            );
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
            expect(text).toContain("not available in streaming request");
            expect(mockApiClient.createStreamProcessor).not.toHaveBeenCalled();
        });

        it("should allow $$ROOT in a pipeline", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }, { name: "sink" }],
            });

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

            expect(result.isError).toBeUndefined();
            expect(mockApiClient.createStreamProcessor).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        pipeline: expect.arrayContaining([{ $replaceRoot: { newRoot: "$$ROOT" } }]),
                    }),
                }),
                expect.anything()
            );
        });

        it("should return error when pipeline contains $$CURRENT", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                pipeline: [
                    { $source: { connectionName: "src" } },
                    { $addFields: { doc: "$$CURRENT" } },
                    { $merge: { into: { connectionName: "sink", db: "db1", coll: "c1" } } },
                ],
            });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("$$CURRENT");
            expect(text).toContain("not available in streaming request");
            expect(mockApiClient.createStreamProcessor).not.toHaveBeenCalled();
        });

        it("should accept $emit as a valid sink stage", async () => {
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

        it("should accept $https as a valid sink stage", async () => {
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

        it("should accept $externalFunction as a valid sink stage", async () => {
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
            const result = await exec({
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

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        provider: "AWS",
                        region: "us-east-1",
                        vendor: "CONFLUENT",
                        serviceEndpointId: "com.amazonaws.vpce.us-east-1.vpce-svc-abc123",
                        dnsDomain: "example.com",
                        dnsSubDomain: ["sub"],
                    },
                },
                expect.anything()
            );
            expect(result.structuredContent).toEqual({
                resource: "privatelink",
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

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        provider: "AWS",
                        region: "us-east-1",
                        vendor: "S3",
                        serviceEndpointId: "com.amazonaws.us-east-1.s3",
                    },
                },
                expect.anything()
            );
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

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        provider: "AWS",
                        vendor: "MSK",
                        arn: "arn:aws:kafka:us-east-1:123456789012:cluster/my-msk/abc-123",
                    },
                },
                expect.anything()
            );
        });

        it("should create an AWS MSK PrivateLink with IAM authentication", async () => {
            await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "AWS",
                    vendor: "MSK",
                    arn: "arn:aws:kafka:us-east-1:123456789012:cluster/my-msk/abc-123",
                    authenticationScheme: "IAM",
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        provider: "AWS",
                        vendor: "MSK",
                        arn: "arn:aws:kafka:us-east-1:123456789012:cluster/my-msk/abc-123",
                        authenticationScheme: "IAM",
                    },
                },
                expect.anything()
            );
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

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        provider: "AWS",
                        region: "us-east-1",
                        vendor: "KINESIS",
                        serviceEndpointId: "com.amazonaws.vpce.us-east-1.vpce-svc-abc123",
                    },
                },
                expect.anything()
            );
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

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        provider: "AZURE",
                        vendor: "EVENTHUB",
                        region: "eastus2",
                        dnsDomain: "mynamespace.servicebus.windows.net",
                        serviceEndpointId:
                            "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.EventHub/namespaces/mynamespace",
                    },
                },
                expect.anything()
            );
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

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        provider: "AZURE",
                        vendor: "CONFLUENT",
                        region: "eastus2",
                        dnsDomain: "pkc-abc123.eastus2.azure.confluent.cloud",
                        azureResourceIds: ["/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Confluent/abc"],
                    },
                },
                expect.anything()
            );
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

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        provider: "GCP",
                        vendor: "CONFLUENT",
                        region: "us-central1",
                        dnsDomain: "pkc-abc123.us-central1.gcp.confluent.cloud",
                        gcpServiceAttachmentUris: ["projects/p1/regions/us-central1/serviceAttachments/att-1"],
                    },
                },
                expect.anything()
            );
        });

        it("should create a GCP PUBSUB PrivateLink", async () => {
            await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "GCP",
                    vendor: "PUBSUB",
                    region: "us-central1",
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        provider: "GCP",
                        vendor: "PUBSUB",
                        region: "us-central1",
                    },
                },
                expect.anything()
            );
        });

        it("should create an AZURE AZURE_BLOB_STORAGE PrivateLink", async () => {
            await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "AZURE",
                    vendor: "AZURE_BLOB_STORAGE",
                    region: "eastus2",
                    dnsDomain: "acmestorage.blob.core.windows.net",
                    serviceEndpointId:
                        "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/acmestorage",
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        provider: "AZURE",
                        vendor: "AZURE_BLOB_STORAGE",
                        region: "eastus2",
                        dnsDomain: "acmestorage.blob.core.windows.net",
                        serviceEndpointId:
                            "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/acmestorage",
                    },
                },
                expect.anything()
            );
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

        it("should create PrivateLink without workspaceName", async () => {
            await exec({
                projectId: "proj1",
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "AWS",
                    region: "us-east-1",
                    vendor: "S3",
                    serviceEndpointId: "com.amazonaws.us-east-1.s3",
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        provider: "AWS",
                        region: "us-east-1",
                        vendor: "S3",
                        serviceEndpointId: "com.amazonaws.us-east-1.s3",
                    },
                },
                expect.anything()
            );
        });
    });

    describe("workspaceName requirement", () => {
        it("should throw when workspaceName is missing for workspace resource", async () => {
            await expect(
                exec({
                    projectId: "proj1",
                    resource: "workspace",
                    cloudProvider: "AWS",
                    region: "VIRGINIA_USA",
                })
            ).rejects.toThrow("workspaceName is required");
        });

        it("should throw when workspaceName is missing for connection resource", async () => {
            await expect(
                exec({
                    projectId: "proj1",
                    resource: "connection",
                    connectionName: "conn1",
                    connectionType: "Sample",
                })
            ).rejects.toThrow("workspaceName is required");
        });

        it("should throw when workspaceName is missing for processor resource", async () => {
            await expect(
                exec({
                    projectId: "proj1",
                    resource: "processor",
                    processorName: "proc1",
                    pipeline: [
                        { $source: { connectionName: "src" } },
                        { $merge: { into: { connectionName: "sink", db: "db1", coll: "c1" } } },
                    ],
                })
            ).rejects.toThrow("workspaceName is required");
        });
    });

    describe("structuredContent", () => {
        it("returns workspace step outcome when a workspace is created", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "workspace",
                cloudProvider: "AWS",
                region: "VIRGINIA_USA",
                tier: "SP30",
            });

            expect(result.structuredContent).toEqual({
                resource: "workspace",
            });
        });

        it("returns processor step outcome when a processor is deployed with autoStart", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [{ name: "src" }, { name: "sink" }],
            });

            const result = await exec({
                ...baseArgs,
                resource: "processor",
                processorName: "proc1",
                autoStart: true,
                pipeline: [
                    { $source: { connectionName: "src" } },
                    { $merge: { into: { connectionName: "sink", db: "db1", coll: "c1" } } },
                ],
            });

            expect(result.structuredContent).toEqual({
                resource: "processor",
            });
        });
    });

    describe("review regressions", () => {
        const serviceAccountId = "atlas-streams@my-project.iam.gserviceaccount.com";
        const connectionId = "64b7e9f1a2c3d4e5f6a7b8c9";
        const servicePrincipalId = "11111111-2222-3333-4444-555555555555";

        const lastConnectionBody = (): Record<string, unknown> => {
            const calls = mockApiClient.createStreamConnection!.mock.calls as unknown as [
                { body: Record<string, unknown> },
            ][];
            return calls.at(-1)![0].body;
        };

        it("accepts the new connection types in the advertised arguments schema", () => {
            const argsSchema = z.object(tool.argsShape());
            for (const connectionType of ["GCPPubSub", "AzureBlobStorage"]) {
                const parsed = argsSchema.safeParse({
                    projectId: connectionId,
                    workspaceName: "ws1",
                    resource: "connection",
                    connectionName: "conn1",
                    connectionType,
                    connectionConfig: {},
                });
                expect(parsed.success).toBe(true);
            }
        });

        it("rejects an invalid publicPrivateNetworking access type", () => {
            expect(ConnectionConfig.safeParse({ publicPrivateNetworking: { access: { type: "BOGUS" } } }).success).toBe(
                false
            );
        });

        it("accepts the documented networking access types", () => {
            for (const type of ["PUBLIC", "VPC", "PRIVATE_LINK", "TRANSIT_GATEWAY"]) {
                expect(ConnectionConfig.safeParse({ networking: { access: { type } } }).success).toBe(true);
            }
        });

        it("rejects an invalid networking access type", () => {
            expect(ConnectionConfig.safeParse({ networking: { access: { type: "BOGUS" } } }).success).toBe(false);
        });

        it("normalizes and validates the PrivateLink vendor", () => {
            expect(PrivateLinkConfig.parse({ provider: "GCP", vendor: "pubsub" }).vendor).toBe("PUBSUB");
            expect(PrivateLinkConfig.parse({ provider: "AZURE", vendor: "azure_blob_storage" }).vendor).toBe(
                "AZURE_BLOB_STORAGE"
            );
            expect(() => PrivateLinkConfig.parse({ provider: "GCP", vendor: "BOGUS" })).toThrow();
        });

        it("documents S3 $emit config fields in the pipeline description", () => {
            const description = tool.argsShape().pipeline.description ?? "";
            expect(description).toContain("config.outputFormat");
            expect(description).toContain("config.compression");
            expect(description).toContain("S3 uses path (not prefix)");
        });

        it("documents Azure Blob Storage $emit config fields in the pipeline description", () => {
            const description = tool.argsShape().pipeline.description ?? "";
            expect(description).toContain("Azure Blob Storage: {$emit: {connectionName, container, path, config:");
            expect(description).toContain("S3/Azure Blob also accept config.compression");
        });

        it("moves Kafka-style networking to publicPrivateNetworking for GCP Pub/Sub", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "pubsub-out",
                connectionType: "GCPPubSub",
                connectionConfig: {
                    gcp: { serviceAccountId },
                    networking: { access: { type: "PRIVATE_LINK", connectionId } },
                },
            });

            expect(lastConnectionBody()).not.toHaveProperty("networking");
            expect(lastConnectionBody().publicPrivateNetworking).toEqual({
                access: { type: "PRIVATE_LINK", connectionId },
            });
            expect((result.content[0] as { text: string }).text).toContain("PENDING");
        });

        it("infers PRIVATE_LINK when only a connectionId is provided", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "pubsub-out",
                connectionType: "GCPPubSub",
                connectionConfig: {
                    gcp: { serviceAccountId },
                    publicPrivateNetworking: { access: { connectionId } },
                },
            });

            expect(lastConnectionBody().publicPrivateNetworking).toEqual({
                access: { type: "PRIVATE_LINK", connectionId },
            });
            expect(mockElicitation.readInput).not.toHaveBeenCalled();
        });

        it("normalizes networking without mutating the input config", () => {
            const access = { connectionId };
            const input = { gcp: { serviceAccountId }, networking: { access } };
            const normalized = StreamsBuildTool["normalizeNetworkingField"](input, "publicPrivateNetworking");

            expect(normalized).not.toBe(input);
            expect(normalized.publicPrivateNetworking).toEqual({
                access: { type: "PRIVATE_LINK", connectionId },
            });
            expect(normalized).not.toHaveProperty("networking");
            expect(input).toEqual({ gcp: { serviceAccountId }, networking: { access: { connectionId } } });
            expect(access).toEqual({ connectionId });
        });

        it("elicits the GCP connectionId on the re-entry round", async () => {
            mockElicitation.readInput.mockReturnValue({ accepted: true, fields: { connectionId } });

            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "pubsub-out",
                connectionType: "GCPPubSub",
                connectionConfig: {
                    gcp: { serviceAccountId },
                    publicPrivateNetworking: { access: { type: "PRIVATE_LINK" } },
                },
            });

            expect(lastConnectionBody().publicPrivateNetworking).toEqual({
                access: { type: "PRIVATE_LINK", connectionId },
            });
        });

        it("lowercases an elicited Azure storage account name", async () => {
            mockElicitation.readInput.mockReturnValue({
                accepted: true,
                fields: { servicePrincipalId, storageAccountName: "AcmeStorage" },
            });

            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "blob-out",
                connectionType: "AzureBlobStorage",
                connectionConfig: {},
            });

            expect(lastConnectionBody().azure).toEqual({
                servicePrincipalId,
                storageAccountName: "acmestorage",
            });
        });

        it("requires connectionId for an Azure PrivateLink connection", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "blob-out",
                connectionType: "AzureBlobStorage",
                connectionConfig: {
                    azure: { servicePrincipalId, storageAccountName: "acmestorage" },
                    publicPrivateNetworking: { access: { type: "PRIVATE_LINK" } },
                },
            });

            const request = mockElicitation.inputRequired.mock.calls[0]![0] as { schema: { required: string[] } };
            expect(result.resultType).toBe("input_required");
            expect(request.schema.required).toEqual(["connectionId"]);
        });

        it("requires connectionId for an AWS Lambda PrivateLink connection", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "lambda1",
                connectionType: "AWSLambda",
                connectionConfig: {
                    aws: { roleArn: "arn:aws:iam::456:role/lambda-role" },
                    networking: { access: { type: "PRIVATE_LINK" } },
                },
            });

            const request = mockElicitation.inputRequired.mock.calls[0]![0] as { schema: { required: string[] } };
            expect(result.resultType).toBe("input_required");
            expect(request.schema.required).toEqual(["connectionId"]);
        });

        it("tells GCP PUBSUB users to use publicPrivateNetworking", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: { provider: "GCP", vendor: "PUBSUB", region: "us-central1" },
            });

            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("publicPrivateNetworking.access.type");
        });

        it("keeps networking wording for AWS CONFLUENT endpoints", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: {
                    provider: "AWS",
                    vendor: "CONFLUENT",
                    region: "us-east-1",
                    serviceEndpointId: "com.amazonaws.vpce.us-east-1.vpce-svc-123",
                    dnsDomain: "confluent.example.com",
                    dnsSubDomain: [],
                },
            });

            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain(" networking.access.type");
            expect(text).not.toContain("publicPrivateNetworking");
        });

        it("requires region for a GCP PUBSUB PrivateLink", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "privatelink",
                    privateLinkConfig: { provider: "GCP", vendor: "PUBSUB" },
                })
            ).rejects.toThrow("privateLinkConfig.region is required for vendor 'PUBSUB'");
        });

        it("requires region, serviceEndpointId, and dnsDomain for an Azure Blob Storage PrivateLink", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "privatelink",
                    privateLinkConfig: { provider: "AZURE", vendor: "AZURE_BLOB_STORAGE" },
                })
            ).rejects.toThrow(/missing required field\(s\).*region, serviceEndpointId, dnsDomain/);
        });

        it("omits an empty dnsDomain for a GCP PUBSUB PrivateLink", async () => {
            await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: { provider: "GCP", vendor: "PUBSUB", region: "us-central1", dnsDomain: "" },
            });

            const calls = mockApiClient.createPrivateLinkConnection!.mock.calls as unknown as [
                { body: Record<string, unknown> },
            ][];
            expect(calls.at(-1)![0].body).not.toHaveProperty("dnsDomain");
        });

        it("tells agents to wait for DONE before using a PrivateLink", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: { provider: "GCP", vendor: "PUBSUB", region: "us-central1" },
            });

            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("state is DONE");
            expect(text).toContain("same cloud provider");
            expect(text).toContain("Only one PUBSUB endpoint is allowed per region");
        });

        it("matches the PrivateLink vendor case-insensitively", async () => {
            const result = await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: { provider: "GCP", vendor: "pubsub", region: "us-central1" },
            });

            expect((result.content[0] as { text: string }).text).toContain("publicPrivateNetworking.access.type");
            const calls = mockApiClient.createPrivateLinkConnection!.mock.calls as unknown as [
                { body: Record<string, unknown> },
            ][];
            expect(calls.at(-1)![0].body.vendor).toBe("PUBSUB");
        });

        it("rejects networking access types other than PUBLIC or PRIVATE_LINK for GCP Pub/Sub", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "connection",
                    connectionName: "pubsub-out",
                    connectionType: "GCPPubSub",
                    connectionConfig: {
                        gcp: { serviceAccountId },
                        networking: { access: { type: "VPC", connectionId } },
                    },
                })
            ).rejects.toThrow("Use 'PUBLIC' or 'PRIVATE_LINK'");
        });

        it("moves networking to publicPrivateNetworking for AWS Lambda", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "lambda1",
                connectionType: "AWSLambda",
                connectionConfig: {
                    aws: { roleArn: "arn:aws:iam::456:role/lambda-role" },
                    networking: { access: { type: "PRIVATE_LINK", connectionId } },
                },
            });

            expect(lastConnectionBody()).not.toHaveProperty("networking");
            expect(lastConnectionBody().publicPrivateNetworking).toEqual({
                access: { type: "PRIVATE_LINK", connectionId },
            });
        });

        it("moves publicPrivateNetworking to networking for S3", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "s3-conn",
                connectionType: "S3",
                connectionConfig: {
                    aws: { roleArn: "arn:aws:iam::456:role/s3-role" },
                    publicPrivateNetworking: { access: { type: "PRIVATE_LINK", connectionId } },
                },
            });

            expect(lastConnectionBody()).not.toHaveProperty("publicPrivateNetworking");
            expect(lastConnectionBody().networking).toEqual({
                access: { type: "PRIVATE_LINK", connectionId },
            });
        });

        it("keeps the PrivateLink block when the target field is an empty object", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "pubsub-out",
                connectionType: "GCPPubSub",
                connectionConfig: {
                    gcp: { serviceAccountId },
                    publicPrivateNetworking: {},
                    networking: { access: { type: "PRIVATE_LINK", connectionId } },
                },
            });

            expect(lastConnectionBody().publicPrivateNetworking).toEqual({
                access: { type: "PRIVATE_LINK", connectionId },
            });
        });

        it("rejects conflicting networking configuration", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "connection",
                    connectionName: "pubsub-out",
                    connectionType: "GCPPubSub",
                    connectionConfig: {
                        gcp: { serviceAccountId },
                        publicPrivateNetworking: { access: { type: "PUBLIC" } },
                        networking: { access: { type: "PRIVATE_LINK", connectionId } },
                    },
                })
            ).rejects.toThrow("Conflicting networking configuration");
        });

        it("rejects networking blocks with different connection IDs", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    resource: "connection",
                    connectionName: "pubsub-out",
                    connectionType: "GCPPubSub",
                    connectionConfig: {
                        gcp: { serviceAccountId },
                        publicPrivateNetworking: { access: { type: "PRIVATE_LINK", connectionId } },
                        networking: {
                            access: { type: "PRIVATE_LINK", connectionId: "111111111111111111111111" },
                        },
                    },
                })
            ).rejects.toThrow("Conflicting networking configuration");
        });

        it("treats semantically equal networking blocks as equal regardless of key order", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "pubsub-out",
                connectionType: "GCPPubSub",
                connectionConfig: {
                    gcp: { serviceAccountId },
                    publicPrivateNetworking: { access: { type: "PRIVATE_LINK", connectionId } },
                    networking: {
                        access: { connectionId, type: "PRIVATE_LINK" },
                        links: [{ href: "https://example.com" }],
                    },
                },
            });

            expect(lastConnectionBody().publicPrivateNetworking).toEqual({
                access: { type: "PRIVATE_LINK", connectionId },
            });
        });

        it("treats an inferred PRIVATE_LINK as equal to an explicit one", async () => {
            await exec({
                ...baseArgs,
                resource: "connection",
                connectionName: "pubsub-out",
                connectionType: "GCPPubSub",
                connectionConfig: {
                    gcp: { serviceAccountId },
                    publicPrivateNetworking: { access: { connectionId } },
                    networking: { access: { type: "PRIVATE_LINK", connectionId } },
                },
            });

            expect(lastConnectionBody().publicPrivateNetworking).toEqual({
                access: { type: "PRIVATE_LINK", connectionId },
            });
        });

        it("returns the new PrivateLink endpoint ID", async () => {
            mockApiClient.createPrivateLinkConnection!.mockResolvedValue({ _id: connectionId });

            const result = await exec({
                ...baseArgs,
                resource: "privatelink",
                privateLinkConfig: { provider: "GCP", vendor: "PUBSUB", region: "us-central1" },
            });

            expect(result.structuredContent).toEqual({
                resource: "privatelink",
                privateLinkId: connectionId,
            });
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain(connectionId);
            expect(text).toContain(`connectionId='${connectionId}'`);
        });
    });
});
