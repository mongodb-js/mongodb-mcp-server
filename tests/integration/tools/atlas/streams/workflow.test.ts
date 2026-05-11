import { expectDefined, getResponseContent } from "../../../helpers.js";
import { describeWithStreams, withWorkspace, randomId, assertApiClientIsAvailable } from "../atlasHelpers.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describeWithStreams("atlas-streams workflows", (integration) => {
    withWorkspace(integration, ({ getProjectId, getWorkspaceName, getClusterConnectionName }) => {
        describe("connection update + verify", () => {
            const connectionName = `httpsconn${randomId().slice(0, 8)}`;

            beforeAll(async () => {
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
                expect(response.isError, `Failed to create connection: ${content}`).toBeFalsy();
            }, 30_000);

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

            it("update-connection — changes URL", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-manage",
                    arguments: {
                        projectId: getProjectId(),
                        workspaceName: getWorkspaceName(),
                        action: "update-connection",
                        resourceName: connectionName,
                        connectionConfig: {
                            name: connectionName,
                            type: "Https",
                            url: "https://httpbin.org/get",
                        },
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Unexpected error: ${content}`).toBeFalsy();
                expect(content).toContain("updated");
            });

            it("update-connection — verify via inspect", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-discover",
                    arguments: {
                        projectId: getProjectId(),
                        action: "inspect-connection",
                        workspaceName: getWorkspaceName(),
                        resourceName: connectionName,
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError).toBeFalsy();
                expect(content).toContain("httpbin.org/get");
            });
        });

        describe("connection teardown", () => {
            const teardownConnName = `teardownconn${randomId().slice(0, 8)}`;

            beforeAll(async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-build",
                    arguments: {
                        projectId: getProjectId(),
                        resource: "connection",
                        workspaceName: getWorkspaceName(),
                        connectionName: teardownConnName,
                        connectionType: "Https",
                        connectionConfig: {
                            url: "https://httpbin.org/post",
                        },
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Failed to create teardown connection: ${content}`).toBeFalsy();
            }, 30_000);

            it("creates connection for teardown test", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-discover",
                    arguments: {
                        projectId: getProjectId(),
                        action: "inspect-connection",
                        workspaceName: getWorkspaceName(),
                        resourceName: teardownConnName,
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError).toBeFalsy();
                expect(content).toContain(teardownConnName);
            });

            it("deletes connection via teardown tool", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-teardown",
                    arguments: {
                        projectId: getProjectId(),
                        resource: "connection",
                        workspaceName: getWorkspaceName(),
                        resourceName: teardownConnName,
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Unexpected error: ${content}`).toBeFalsy();
                expect(content).toContain("deletion initiated");
            }, 30_000);
        });

        describe("processor lifecycle", () => {
            const processorName = `testproc${randomId().slice(0, 8)}`;

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

            it("creates processor successfully", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-discover",
                    arguments: {
                        projectId: getProjectId(),
                        action: "inspect-processor",
                        workspaceName: getWorkspaceName(),
                        resourceName: processorName,
                    },
                });
                const content = getResponseContent(response.content);
                expect(content).toContain(processorName);
            });

            describe("atlas-streams-discover — after processor exists", () => {
                it("inspect-processor — returns details", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "atlas-streams-discover",
                        arguments: {
                            projectId: getProjectId(),
                            action: "inspect-processor",
                            workspaceName: getWorkspaceName(),
                            resourceName: processorName,
                        },
                    });
                    const content = getResponseContent(response.content);
                    expect(content).toContain(processorName);
                    expect(content).toContain("<untrusted-user-data-");
                });

                it("diagnose-processor — returns health report", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "atlas-streams-discover",
                        arguments: {
                            projectId: getProjectId(),
                            action: "diagnose-processor",
                            workspaceName: getWorkspaceName(),
                            resourceName: processorName,
                        },
                    });
                    const content = getResponseContent(response.content);
                    expect(content).toContain("Processor State");
                    expect(content).toContain(processorName);
                });
            });

            describe("atlas-streams-manage", () => {
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
                }, 30_000);

                it("modify-processor — verify pipeline persisted", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "atlas-streams-discover",
                        arguments: {
                            projectId: getProjectId(),
                            action: "inspect-processor",
                            workspaceName: getWorkspaceName(),
                            resourceName: processorName,
                        },
                    });
                    const content = getResponseContent(response.content);
                    expect(response.isError).toBeFalsy();
                    expect(content).toContain("device_1");
                });

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

                it("update-workspace — verify via inspect", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "atlas-streams-discover",
                        arguments: {
                            projectId: getProjectId(),
                            action: "inspect-workspace",
                            workspaceName: getWorkspaceName(),
                        },
                    });
                    const content = getResponseContent(response.content);
                    expect(response.isError).toBeFalsy();
                    expect(content).toContain("SP30");
                });
            });

            describe("atlas-streams-teardown", () => {
                it("deletes processor permanently", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "atlas-streams-teardown",
                        arguments: {
                            projectId: getProjectId(),
                            resource: "processor",
                            workspaceName: getWorkspaceName(),
                            resourceName: processorName,
                        },
                    });
                    const content = getResponseContent(response.content);
                    expect(content).toContain("deleted");
                }, 30_000);
            });
        });

        describe("workspace lifecycle", () => {
            const lifecycleWsName = `lifecyclews${randomId().slice(0, 8)}`;
            let createContent: string | undefined;
            let createIsError: boolean | undefined;

            beforeAll(async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-build",
                    arguments: {
                        projectId: getProjectId(),
                        resource: "workspace",
                        workspaceName: lifecycleWsName,
                        cloudProvider: "AWS",
                        region: "VIRGINIA_USA",
                        includeSampleData: false,
                    },
                });
                createContent = getResponseContent(response.content);
                createIsError = !!response.isError;
            }, 120_000);

            afterAll(async () => {
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                try {
                    await session.apiClient.deleteStreamWorkspace({
                        params: {
                            path: {
                                groupId: getProjectId(),
                                tenantName: lifecycleWsName,
                            },
                        },
                    });
                } catch {
                    // ignore — teardown test may have already deleted it
                }
            });

            it("creates workspace via build tool", () => {
                expectDefined(createContent);
                expect(createIsError, `Unexpected error: ${createContent}`).toBeFalsy();
                expect(createContent).toContain(lifecycleWsName);
                expect(createContent).toContain("created");
            });

            it("new workspace visible in list-workspaces", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-discover",
                    arguments: {
                        projectId: getProjectId(),
                        action: "list-workspaces",
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError).toBeFalsy();
                expect(content).toContain(lifecycleWsName);
            });

            it("deletes workspace via teardown tool", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-teardown",
                    arguments: {
                        projectId: getProjectId(),
                        resource: "workspace",
                        workspaceName: lifecycleWsName,
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Unexpected error: ${content}`).toBeFalsy();
                expect(content).toContain("deletion initiated");
            }, 30_000);
        });
    });
});
