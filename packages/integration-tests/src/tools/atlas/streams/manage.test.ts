import { expectDefined, getResponseContent } from "../../../integrationHelpers.js";
import { describeWithStreams, withWorkspace, randomId, assertApiClientIsAvailable } from "../atlasHelpers.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const catalogFixtures = [
    {
        provider: "DATABRICKS_UNITY",
        env: "MDB_MCP_TEST_STREAMS_UNITY_CATALOG",
        settingsKey: "databricks",
        secretField: "clientSecret",
        authentication: z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) }),
    },
    {
        provider: "SNOWFLAKE_HORIZON",
        env: "MDB_MCP_TEST_STREAMS_HORIZON_CATALOG",
        settingsKey: "snowflake",
        secretField: "privateKey",
        authentication: z.object({
            account: z.string().min(1),
            user: z.string().min(1),
            role: z.string().min(1),
            privateKey: z.string().min(1),
        }),
    },
] as const;

describeWithStreams("atlas-streams-manage", (integration) => {
    describe("tool registration", () => {
        it("registers atlas-streams-manage with correct metadata", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const tool = tools.find((t) => t.name === "atlas-streams-manage");
            expect(tool).toBeDefined();
            expect(tool!.inputSchema.type).toBe("object");
            expect(tool!.inputSchema.properties).toBeDefined();
            expect(tool!.inputSchema.properties).toHaveProperty("projectId");
            expect(tool!.inputSchema.properties).toHaveProperty("action");
        });
    });

    withWorkspace(integration, ({ getProjectId, getWorkspaceName, getClusterConnectionName }) => {
        for (const { provider, env, settingsKey, secretField, authentication } of catalogFixtures) {
            const rawFixture = process.env[env];
            it.skipIf(!rawFixture)(
                `creates, rotates, updates, and discovers a ${provider} catalog connection`,
                async () => {
                    const endpoint = z.object({ catalogUrl: z.string().min(1), authentication });
                    const schema = z.object({
                        initial: endpoint,
                        rotatedSecret: z.string().min(1),
                        alternate: endpoint,
                    });
                    let parsed: unknown;
                    try {
                        parsed = JSON.parse(rawFixture ?? "");
                    } catch {
                        throw new Error(`${env} must contain valid JSON.`);
                    }
                    const fixture = schema.safeParse(parsed);
                    if (!fixture.success) {
                        throw new Error(`${env} must supply initial and alternate endpoints and a rotatedSecret.`);
                    }
                    const { initial, rotatedSecret, alternate } = fixture.data;
                    const secrets = [initial.authentication, alternate.authentication].map((auth) =>
                        secretField === "clientSecret" && "clientSecret" in auth
                            ? auth.clientSecret
                            : "privateKey" in auth
                              ? auth.privateKey
                              : ""
                    );
                    if (initial.catalogUrl === alternate.catalogUrl || secrets[0] === rotatedSecret) {
                        throw new Error(`${env} must provide a different URL and a different rotation credential.`);
                    }
                    secrets.push(rotatedSecret);

                    const connectionName = `catalog${randomId().slice(0, 8)}`;
                    const base = { projectId: getProjectId(), workspaceName: getWorkspaceName() };
                    const client = integration.mcpClient();
                    const checkResult = (response: { isError?: boolean }, action: string): void => {
                        expect(response.isError, `${action} failed for ${provider}`).toBeFalsy();
                        const output = JSON.stringify(response);
                        for (const secret of secrets.filter(Boolean)) {
                            const escaped = JSON.stringify(secret).slice(1, -1);
                            expect(
                                output.includes(escaped) || output.includes(JSON.stringify(escaped).slice(1, -1))
                            ).toBe(false);
                        }
                    };

                    try {
                        checkResult(
                            await client.callTool({
                                name: "atlas-streams-build",
                                arguments: {
                                    ...base,
                                    resource: "connection",
                                    connectionName,
                                    connectionType: "DataCatalog",
                                    connectionConfig: {
                                        catalogProvider: provider,
                                        catalogUrl: initial.catalogUrl,
                                        [settingsKey]: { authentication: initial.authentication },
                                    },
                                },
                            }),
                            "Create"
                        );
                        for (const connectionConfig of [
                            { [settingsKey]: { authentication: { [secretField]: rotatedSecret } } },
                            {
                                catalogUrl: alternate.catalogUrl,
                                [settingsKey]: { authentication: alternate.authentication },
                            },
                        ]) {
                            checkResult(
                                await client.callTool({
                                    name: "atlas-streams-manage",
                                    arguments: {
                                        ...base,
                                        action: "update-connection",
                                        resourceName: connectionName,
                                        connectionConfig,
                                    },
                                }),
                                "Update"
                            );
                        }
                        const listed = await client.callTool({
                            name: "atlas-streams-discover",
                            arguments: { ...base, action: "list-connections", responseFormat: "detailed" },
                        });
                        checkResult(listed, "List");
                        expect(listed.structuredContent).toHaveProperty(
                            "connections",
                            expect.arrayContaining([
                                {
                                    name: connectionName,
                                    type: "DataCatalog",
                                    catalogProvider: provider,
                                    state: "READY",
                                },
                            ])
                        );

                        const inspected = await client.callTool({
                            name: "atlas-streams-discover",
                            arguments: { ...base, action: "inspect-connection", resourceName: connectionName },
                        });
                        checkResult(inspected, "Inspect");
                        expect(inspected.structuredContent).toMatchObject({
                            connection: {
                                type: "DataCatalog",
                                catalogProvider: provider,
                                catalogUrl: alternate.catalogUrl,
                            },
                        });
                    } finally {
                        const server = integration.mcpServer();
                        assertApiClientIsAvailable(server);
                        await server.apiClient
                            .deleteStreamConnection({
                                params: {
                                    path: { groupId: base.projectId, tenantName: base.workspaceName, connectionName },
                                },
                            })
                            .catch(() => undefined);
                    }
                },
                60_000
            );
        }

        describe("processor management", () => {
            const processorName = `manageproc${randomId().slice(0, 8)}`;

            afterAll(async () => {
                // The shared workspace is reused across all streams test files, so clean
                // up the processor we created to leave the workspace in its initial state
                // (discover.test.ts asserts "list-processors is empty").
                const server = integration.mcpServer();
                assertApiClientIsAvailable(server);
                try {
                    await server.apiClient.deleteStreamProcessor({
                        params: {
                            path: {
                                groupId: getProjectId(),
                                tenantName: getWorkspaceName(),
                                processorName,
                            },
                        },
                    });
                } catch {
                    // ignore cleanup errors
                }
            });

            beforeAll(async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-build",
                    arguments: {
                        projectId: getProjectId(),
                        resource: "processor",
                        workspaceName: getWorkspaceName(),
                        processorName,
                        processorTier: "SP10",
                        autoscaling: { enabled: true, minTier: "SP5", maxTier: "SP30" },
                        pipeline: [
                            { $source: { connectionName: "sample_stream_solar" } },
                            {
                                $merge: {
                                    into: {
                                        connectionName: getClusterConnectionName(),
                                        db: "test",
                                        coll: "out",
                                    },
                                },
                            },
                        ],
                        autoStart: false,
                    },
                });
                const content = getResponseContent(response.content);
                expect(content).toContain(processorName);
                expect(content).toContain("deployed");
            }, 60_000);

            it("create processor — persists baseline tier and autoscaling", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-discover",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        action: "inspect-processor",
                        resourceName: processorName,
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Unexpected error: ${content}`).toBeFalsy();
                expectDefined(response.structuredContent);
                expect(response.structuredContent).toMatchObject({
                    tier: "SP10",
                    autoscaling: { enabled: true, minTier: "SP5", maxTier: "SP30" },
                });
            }, 30_000);

            it("start-processor — starts successfully", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-manage",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        action: "start-processor",
                        resourceName: processorName,
                    },
                });
                const content = getResponseContent(response.content);
                expect(content).toContain("started");
                expectDefined(response.structuredContent);
                expect(response.structuredContent).toEqual({ processorState: "STARTED" });
            }, 30_000);

            it("stop-processor — stops successfully", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-manage",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        action: "stop-processor",
                        resourceName: processorName,
                    },
                });
                const content = getResponseContent(response.content);
                expect(content).toContain("stopped");
                expectDefined(response.structuredContent);
                expect(response.structuredContent).toEqual({ processorState: "STOPPED" });
            }, 30_000);

            it("modify-processor — updates and resets autoscaling", async () => {
                const updateResponse = await integration.mcpClient().callTool({
                    name: "atlas-streams-manage",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        action: "modify-processor",
                        resourceName: processorName,
                        tier: "SP5",
                        autoscaling: { enabled: true, minTier: null, maxTier: "SP30" },
                    },
                });
                const updateContent = getResponseContent(updateResponse.content);
                expect(updateResponse.isError, `Unexpected error: ${updateContent}`).toBeFalsy();
                expectDefined(updateResponse.structuredContent);
                expect(updateResponse.structuredContent).toMatchObject({
                    processorState: "STOPPED",
                    tier: "SP5",
                    autoscaling: { enabled: true, maxTier: "SP30" },
                });

                const disableResponse = await integration.mcpClient().callTool({
                    name: "atlas-streams-manage",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        action: "modify-processor",
                        resourceName: processorName,
                        autoscaling: { enabled: false },
                    },
                });
                const disableContent = getResponseContent(disableResponse.content);
                expect(disableResponse.isError, `Unexpected error: ${disableContent}`).toBeFalsy();
                expect(disableResponse.structuredContent).toMatchObject({
                    processorState: "STOPPED",
                });
                expect(disableResponse.structuredContent).not.toHaveProperty("autoscaling");
            }, 30_000);

            it("modify-processor — changes pipeline", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-manage",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        action: "modify-processor",
                        resourceName: processorName,
                        pipeline: [
                            { $source: { connectionName: "sample_stream_solar" } },
                            { $match: { device_id: "device_1" } },
                            {
                                $merge: {
                                    into: {
                                        connectionName: getClusterConnectionName(),
                                        db: "test",
                                        coll: "out",
                                    },
                                },
                            },
                        ],
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Unexpected error: ${content}`).toBeFalsy();
                expect(content).toContain("modified");
                expectDefined(response.structuredContent);
                expect(response.structuredContent).toEqual({ processorState: "STOPPED" });
            }, 30_000);

            it("update-workspace — changes tier to SP30", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-manage",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        action: "update-workspace",
                        newTier: "SP30",
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Unexpected error: ${content}`).toBeFalsy();
                expect(content).toContain("updated");
            }, 30_000);
        });

        // TODO(CLOUDP-388366): Add integration tests requiring VPC peering infrastructure:
        // - accept-peering
        // - reject-peering
    });
});
