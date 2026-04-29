import { getResponseContent } from "../../../helpers.js";
import { describeWithStreams, withWorkspace, randomId } from "../atlasHelpers.js";
import { beforeAll, describe, expect, it } from "vitest";

describeWithStreams("atlas-streams-manage", (integration) => {
    describe("tool registration", () => {
        it("registers atlas-streams-manage with correct metadata", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const tool = tools.find((t) => t.name === "atlas-streams-manage");
            expect(tool).toBeDefined();
            expect(tool!.inputSchema.type).toBe("object");
            expect(tool!.inputSchema.properties).toBeDefined();
            expect(tool!.inputSchema.properties).toHaveProperty("projectId");
            expect(tool!.inputSchema.properties).toHaveProperty("workspaceName");
            expect(tool!.inputSchema.properties).toHaveProperty("operation");
        });
    });

    withWorkspace(integration, ({ getProjectId, getWorkspaceName, getClusterConnectionName }) => {
        describe("processor management", () => {
            const processorName = `manageproc${randomId().slice(0, 8)}`;

            beforeAll(async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-build",
                    arguments: {
                        projectId: getProjectId(),
                        resource: "processor",
                        workspaceName: getWorkspaceName(),
                        processorName,
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

            it("start-processor — starts successfully", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-manage",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        operation: [{ action: "start-processor", resourceName: processorName }],
                    },
                });
                const content = getResponseContent(response.content);
                expect(content).toContain("started");
            }, 30_000);

            it("stop-processor — stops successfully", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-manage",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        operation: [{ action: "stop-processor", resourceName: processorName }],
                    },
                });
                const content = getResponseContent(response.content);
                expect(content).toContain("stopped");
            }, 30_000);

            it("modify-processor — changes pipeline", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-manage",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        operation: [
                            {
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
                        ],
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Unexpected error: ${content}`).toBeFalsy();
                expect(content).toContain("modified");
            }, 30_000);

            it("update-workspace — changes tier to SP30", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-manage",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        operation: [{ action: "update-workspace", newTier: "SP30" }],
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
