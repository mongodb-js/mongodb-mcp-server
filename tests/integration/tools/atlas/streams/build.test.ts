import { getResponseContent } from "../../../helpers.js";
import { describeWithStreams, withWorkspace, randomId, assertApiClientIsAvailable } from "../atlasHelpers.js";
import { afterAll, describe, expect, it } from "vitest";

describeWithStreams("atlas-streams-build", (integration) => {
    describe("tool registration", () => {
        it("registers atlas-streams-build with correct metadata", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const tool = tools.find((t) => t.name === "atlas-streams-build");
            expect(tool).toBeDefined();
            expect(tool!.inputSchema.type).toBe("object");
            expect(tool!.inputSchema.properties).toBeDefined();
            expect(tool!.inputSchema.properties).toHaveProperty("projectId");
            expect(tool!.inputSchema.properties).toHaveProperty("resource");
        });
    });

    withWorkspace(integration, ({ getProjectId, getWorkspaceName }) => {
        describe("HTTPS connection", () => {
            const connectionName = `httpsconn${randomId().slice(0, 8)}`;

            afterAll(async () => {
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                try {
                    await session.apiClient.deleteStreamConnection({
                        params: {
                            path: {
                                groupId: getProjectId(),
                                tenantName: getWorkspaceName(),
                                connectionName,
                            },
                        },
                    });
                } catch {
                    // ignore cleanup errors
                }
            });

            it("creates an HTTPS connection", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-build",
                    arguments: {
                        projectId: getProjectId(),
                        resource: "connection",
                        workspaceName: getWorkspaceName(),
                        connectionName,
                        connectionType: "Https",
                        connectionConfig: {
                            url: "https://httpbin.org/post",
                        },
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Unexpected error: ${content}`).toBeFalsy();
                expect(content).toContain(connectionName);
                expect(content).toContain("Https");
            });
        });

        describe("kafka connection", () => {
            const kafkaConnName = `kafkaconn${randomId().slice(0, 8)}`;

            afterAll(async () => {
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                try {
                    await session.apiClient.deleteStreamConnection({
                        params: {
                            path: {
                                groupId: getProjectId(),
                                tenantName: getWorkspaceName(),
                                connectionName: kafkaConnName,
                            },
                        },
                    });
                } catch {
                    // ignore cleanup errors
                }
            });

            it("creates a Kafka connection with dummy creds", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-build",
                    arguments: {
                        projectId: getProjectId(),
                        resource: "connection",
                        workspaceName: getWorkspaceName(),
                        connectionName: kafkaConnName,
                        connectionType: "Kafka",
                        connectionConfig: {
                            bootstrapServers: "dummy-broker.example.com:9092",
                            authentication: {
                                mechanism: "PLAIN",
                                username: "dummy-user",
                                password: "dummy-pass",
                            },
                            security: { protocol: "SASL_SSL" },
                        },
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Unexpected error: ${content}`).toBeFalsy();
                expect(content).toContain(kafkaConnName);
                expect(content).toContain("Kafka");
            });
        });

        describe("schema registry connection", () => {
            const srConnName = `srconn${randomId().slice(0, 8)}`;

            afterAll(async () => {
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                try {
                    await session.apiClient.deleteStreamConnection({
                        params: {
                            path: {
                                groupId: getProjectId(),
                                tenantName: getWorkspaceName(),
                                connectionName: srConnName,
                            },
                        },
                    });
                } catch {
                    // ignore cleanup errors
                }
            });

            it("creates a SchemaRegistry connection with dummy creds", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-build",
                    arguments: {
                        projectId: getProjectId(),
                        resource: "connection",
                        workspaceName: getWorkspaceName(),
                        connectionName: srConnName,
                        connectionType: "SchemaRegistry",
                        connectionConfig: {
                            schemaRegistryUrls: ["https://dummy-registry.example.com"],
                            provider: "CONFLUENT",
                            schemaRegistryAuthentication: {
                                type: "USER_INFO",
                                username: "dummy-user",
                                password: "dummy-pass",
                            },
                        },
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Unexpected error: ${content}`).toBeFalsy();
                expect(content).toContain(srConnName);
                expect(content).toContain("SchemaRegistry");
            });
        });

        // TODO: Add integration tests requiring external infrastructure:
        // - S3 connection creation (requires AWS IAM role ARN registered in Atlas)
        // - AWSKinesisDataStreams connection creation (requires AWS IAM role ARN)
        // - AWSLambda connection creation (requires AWS IAM role ARN)
        // - PrivateLink creation (requires provider-specific infrastructure)
    });
});
