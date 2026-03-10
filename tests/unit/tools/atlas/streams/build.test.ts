import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { StreamsBuildTool } from "../../../../../src/tools/atlas/streams/build.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logger.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";

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
            previewFeatures: ["streams"],
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
            uiRegistry: new UIRegistry(),
        };

        tool = new StreamsBuildTool(params);
    });

    const baseArgs = { projectId: "proj1", workspaceName: "ws1" };

    describe("createWorkspace", () => {
        it("should create workspace with correct provider/region/tier", async () => {
            const result = await tool["execute"]({
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
            await tool["execute"]({
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
            await tool["execute"]({
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
                tool["execute"]({
                    ...baseArgs,
                    resource: "workspace",
                    region: "VIRGINIA_USA",
                })
            ).rejects.toThrow("cloudProvider is required");
        });

        it("should throw when region is missing", async () => {
            await expect(
                tool["execute"]({
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
            mockApiClient.listStreamConnections.mockResolvedValue({
                results: [{ name: "src" }, { name: "sink" }],
            });

            const result = await tool["execute"]({
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
                tool["execute"]({
                    ...baseArgs,
                    resource: "processor",
                    pipeline: [{ $source: { connectionName: "src" } }],
                })
            ).rejects.toThrow("processorName is required");
        });

        it("should throw when pipeline is missing", async () => {
            await expect(
                tool["execute"]({
                    ...baseArgs,
                    resource: "processor",
                    processorName: "proc1",
                })
            ).rejects.toThrow("pipeline is required");
        });

        it("should auto-start processor when autoStart is true", async () => {
            mockApiClient.listStreamConnections.mockResolvedValue({
                results: [{ name: "src" }, { name: "sink" }],
            });

            const result = await tool["execute"]({
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
            expect((result.content[0] as { text: string }).text).toContain("created and started");
        });
    });

    describe("createConnection", () => {
        it("should create Kafka connection and normalize bootstrapServers array", async () => {
            await tool["execute"]({
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

            const callBody = mockApiClient.createStreamConnection.mock.calls[0][0].body;
            expect(callBody.bootstrapServers).toBe("broker1:9092,broker2:9092");
            expect(callBody.name).toBe("kafka1");
            expect(callBody.type).toBe("Kafka");
        });

        it("should create Cluster connection and set default dbRoleToExecute", async () => {
            await tool["execute"]({
                ...baseArgs,
                resource: "connection",
                connectionName: "cluster1",
                connectionType: "Cluster",
                connectionConfig: {
                    clusterName: "my-cluster",
                },
            });

            const callBody = mockApiClient.createStreamConnection.mock.calls[0][0].body;
            expect(callBody.clusterName).toBe("my-cluster");
            expect(callBody.dbRoleToExecute).toEqual({ role: "readWriteAnyDatabase", type: "BUILT_IN" });
        });

        it("should create S3 connection with roleArn in aws config", async () => {
            await tool["execute"]({
                ...baseArgs,
                resource: "connection",
                connectionName: "s3-conn",
                connectionType: "S3",
                connectionConfig: {
                    aws: { roleArn: "arn:aws:iam::123456789:role/my-role" },
                },
            });

            const callBody = mockApiClient.createStreamConnection.mock.calls[0][0].body;
            expect(callBody.aws.roleArn).toBe("arn:aws:iam::123456789:role/my-role");
            expect(callBody.type).toBe("S3");
        });

        it("should trigger elicitation when Kafka missing required fields", async () => {
            mockElicitation.requestInput.mockResolvedValue({ accepted: false });

            const result = await tool["execute"]({
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

            const result = await tool["execute"]({
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
                tool["execute"]({
                    ...baseArgs,
                    resource: "connection",
                    connectionType: "Kafka",
                })
            ).rejects.toThrow("connectionName is required");
        });

        it("should throw when connectionType is missing", async () => {
            await expect(
                tool["execute"]({
                    ...baseArgs,
                    resource: "connection",
                    connectionName: "conn1",
                })
            ).rejects.toThrow("connectionType is required");
        });
    });

    describe("createPrivateLink", () => {
        it("should create PrivateLink connection with correct params", async () => {
            await tool["execute"]({
                ...baseArgs,
                resource: "privatelink",
                privateLinkProvider: "AWS",
                privateLinkConfig: {
                    region: "us-east-1",
                    vendor: "AWS",
                    arn: "arn:aws:...",
                    dnsDomain: "example.com",
                    dnsSubDomain: "sub",
                },
            });

            expect(mockApiClient.createPrivateLinkConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1" } },
                body: {
                    provider: "AWS",
                    region: "us-east-1",
                    vendor: "AWS",
                    arn: "arn:aws:...",
                    dnsDomain: "example.com",
                    dnsSubDomain: "sub",
                },
            });
        });

        it("should throw when privateLinkProvider is missing", async () => {
            await expect(
                tool["execute"]({
                    ...baseArgs,
                    resource: "privatelink",
                    privateLinkConfig: { region: "us-east-1" },
                })
            ).rejects.toThrow("privateLinkProvider is required");
        });

        it("should throw when privateLinkConfig is missing", async () => {
            await expect(
                tool["execute"]({
                    ...baseArgs,
                    resource: "privatelink",
                    privateLinkProvider: "AWS",
                })
            ).rejects.toThrow("privateLinkConfig is required");
        });
    });
});
