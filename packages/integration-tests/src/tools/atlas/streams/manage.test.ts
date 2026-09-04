import { expectDefined, getResponseContent } from "../../../integrationHelpers.js";
import { describeWithStreams, withWorkspace, randomId, assertApiClientIsAvailable } from "../atlasHelpers.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
        describe("processor management", () => {
            const processorName = `manageproc${randomId().slice(0, 8)}`;

            afterAll(async () => {
                // The shared workspace is reused across all streams test files, so clean
                // up the processor we created to leave the workspace in its initial state
                // (discover.test.ts asserts "list-processors is empty").
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                try {
                    await session.apiClient.deleteStreamProcessor({
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
                        autoscaling: null,
                    },
                });
                const disableContent = getResponseContent(disableResponse.content);
                expect(disableResponse.isError, `Unexpected error: ${disableContent}`).toBeFalsy();
                expect(disableResponse.structuredContent).toMatchObject({
                    processorState: "STOPPED",
                    autoscaling: null,
                });
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
