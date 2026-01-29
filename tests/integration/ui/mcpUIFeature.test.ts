import { describe, expect, it, afterAll } from "vitest";
import { describeWithMongoDB } from "../tools/mongodb/mongodbHelpers.js";
import { defaultTestConfig, expectDefined, getResponseElements } from "../helpers.js";
import { CompositeLogger } from "../../../src/common/logger.js";
import { ExportsManager } from "../../../src/common/exportsManager.js";
import { Session } from "../../../src/common/session.js";
import { Telemetry } from "../../../src/telemetry/telemetry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "../../../src/server.js";
import { MCPConnectionManager } from "../../../src/common/connectionManager.js";
import { DeviceId } from "../../../src/helpers/deviceId.js";
import { connectionErrorHandler } from "../../../src/common/connectionErrorHandler.js";
import { Keychain } from "../../../src/common/keychain.js";
import { Elicitation } from "../../../src/elicitation.js";
import { VectorSearchEmbeddingsManager } from "../../../src/common/search/vectorSearchEmbeddingsManager.js";
import { defaultCreateAtlasLocalClient } from "../../../src/common/atlasLocal.js";
import { InMemoryTransport } from "../../../src/transports/inMemoryTransport.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { UIRegistry } from "../../../src/ui/index.js";

describeWithMongoDB(
    "mcpUI feature with feature disabled (default)",
    (integration) => {
        describe("list-databases tool", () => {
            it("should NOT return UIResource content when mcpUI feature is disabled", async () => {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "list-databases",
                    arguments: {},
                });

                expect(response.content).toBeDefined();
                expect(Array.isArray(response.content)).toBe(true);

                const elements = response.content as Array<{ type: string }>;
                const resourceElements = elements.filter((e) => e.type === "resource");
                expect(resourceElements).toHaveLength(0);

                const textElements = getResponseElements(response.content);
                expect(textElements.length).toBeGreaterThan(0);
            });
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: [], // mcpUI is NOT enabled
        }),
    }
);

describeWithMongoDB(
    "mcpUI feature with feature enabled",
    (integration) => {
        describe("list-databases tool with mcpUI enabled", () => {
            it("should return UIResource content when mcpUI feature is enabled", async () => {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "list-databases",
                    arguments: {},
                });

                expect(response.content).toBeDefined();
                expect(Array.isArray(response.content)).toBe(true);

                const elements = response.content as Array<{ type: string; resource?: unknown }>;

                const textElements = elements.filter((e) => e.type === "text");
                expect(textElements.length).toBeGreaterThan(0);

                const resourceElements = elements.filter((e) => e.type === "resource");
                expect(resourceElements).toHaveLength(1);

                const uiResource = resourceElements[0] as {
                    type: string;
                    resource: {
                        uri: string;
                        mimeType: string;
                        text: string;
                        _meta?: Record<string, unknown>;
                    };
                };

                expect(uiResource.type).toBe("resource");
                expectDefined(uiResource.resource);
                expect(uiResource.resource.uri).toBe("ui://list-databases");
                expect(uiResource.resource.mimeType).toBe("text/html");
                expect(typeof uiResource.resource.text).toBe("string");
                expect(uiResource.resource.text.length).toBeGreaterThan(0);

                expectDefined(uiResource.resource._meta);
                expect(uiResource.resource._meta["mcpui.dev/ui-initial-render-data"]).toBeDefined();

                const renderData = uiResource.resource._meta["mcpui.dev/ui-initial-render-data"] as {
                    databases: Array<{ name: string; size: number }>;
                    totalCount: number;
                };
                expect(renderData.databases).toBeInstanceOf(Array);
                expect(typeof renderData.totalCount).toBe("number");
                expect(renderData.totalCount).toBe(renderData.databases.length);

                for (const db of renderData.databases) {
                    expect(typeof db.name).toBe("string");
                    expect(typeof db.size).toBe("number");
                }
            });

            it("should include system databases in the response", async () => {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "list-databases",
                    arguments: {},
                });

                const elements = response.content as Array<{
                    type: string;
                    resource?: { _meta?: Record<string, unknown> };
                }>;
                const resourceElement = elements.find((e) => e.type === "resource");
                expectDefined(resourceElement);

                const renderData = resourceElement.resource?._meta?.["mcpui.dev/ui-initial-render-data"] as {
                    databases: Array<{ name: string; size: number }>;
                };

                const dbNames = renderData.databases.map((db) => db.name);

                expect(dbNames).toContain("admin");
                expect(dbNames).toContain("local");
            });
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: ["mcpUI"], // mcpUI IS enabled
        }),
    }
);

describeWithMongoDB(
    "mcpUI feature - UIRegistry initialization",
    (integration) => {
        describe("server UIRegistry", () => {
            it("should have UIRegistry initialized with bundled UIs", async () => {
                const server = integration.mcpServer();
                expectDefined(server.uiRegistry);

                const uiHtml = await server.uiRegistry.get("list-databases");
                expectDefined(uiHtml);
                expect(uiHtml).not.toBeNull();
                expect(uiHtml.length).toBeGreaterThan(0);
            });
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: ["mcpUI"],
        }),
    }
);

describe("mcpUI feature with custom UIs", () => {
    const initServerWithCustomUIs = async (
        customUIs: Record<string, string>
    ): Promise<{ server: Server; transport: Transport }> => {
        const customUIsFunction = (toolName: string): string | null => customUIs[toolName] ?? null;
        const userConfig = {
            ...defaultTestConfig,
            previewFeatures: ["mcpUI" as const],
        };
        const logger = new CompositeLogger();
        const deviceId = DeviceId.create(logger);
        const connectionManager = new MCPConnectionManager(userConfig, logger, deviceId);
        const exportsManager = ExportsManager.init(userConfig, logger);

        const session = new Session({
            userConfig,
            logger,
            exportsManager,
            connectionManager,
            keychain: Keychain.root,
            vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(userConfig, connectionManager),
            atlasLocalClient: await defaultCreateAtlasLocalClient({ logger }),
        });

        const telemetry = Telemetry.create(session, userConfig, deviceId);
        const mcpServerInstance = new McpServer({ name: "test", version: "1.0" });
        const elicitation = new Elicitation({ server: mcpServerInstance.server });

        const server = new Server({
            session,
            userConfig,
            telemetry,
            mcpServer: mcpServerInstance,
            elicitation,
            connectionErrorHandler,
            uiRegistry: new UIRegistry({ customUIs: customUIsFunction }),
        });

        const transport = new InMemoryTransport();

        return { transport, server };
    };

    let server: Server | undefined;
    let transport: Transport | undefined;

    afterAll(async () => {
        await transport?.close();
        await server?.close();
    });

    it("should use custom UI when provided via server options", async () => {
        const customUIs = {
            "list-databases": "<html>Custom Test UI</html>",
        };

        ({ server, transport } = await initServerWithCustomUIs(customUIs));
        await server.connect(transport);

        expectDefined(server.uiRegistry);
        const uiHtml = await server.uiRegistry.get("list-databases");
        expectDefined(uiHtml);
        expect(uiHtml).toBe("<html>Custom Test UI</html>");
    });

    it("should add new custom UIs for tools without bundled UIs", async () => {
        const customUIs = {
            "custom-tool": "<html>Custom Tool UI</html>",
        };

        ({ server, transport } = await initServerWithCustomUIs(customUIs));
        await server.connect(transport);

        expectDefined(server.uiRegistry);
        const uiHtml = await server.uiRegistry.get("custom-tool");
        expectDefined(uiHtml);
        expect(uiHtml).toBe("<html>Custom Tool UI</html>");
    });

    it("should merge custom UIs with bundled UIs", async () => {
        const customUIs = {
            "new-tool": "<html>New Tool UI</html>",
        };

        ({ server, transport } = await initServerWithCustomUIs(customUIs));
        await server.connect(transport);

        expectDefined(server.uiRegistry);

        const newToolUI = await server.uiRegistry.get("new-tool");
        expectDefined(newToolUI);
        expect(newToolUI).toBe("<html>New Tool UI</html>");

        const bundledUI = await server.uiRegistry.get("list-databases");
        expectDefined(bundledUI);
        expect(bundledUI).not.toBeNull();
        expect(bundledUI.length).toBeGreaterThan(0);
    });
});
