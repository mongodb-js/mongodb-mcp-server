import { expect, it } from "vitest";
import { describeWithMongoDB } from "../mongodbHelpers.js";
import { defaultTestConfig, expectDefined } from "../integrationHelpers.js";

interface ToolMeta {
    ui?: { resourceUri?: string };
}

describeWithMongoDB(
    "mcpApps feature with feature disabled (default)",
    (integration) => {
        it("should NOT advertise ui metadata on tools, and should not wire an AppRegistry", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const explainTool = tools.find((t) => t.name === "explain");
            expectDefined(explainTool);
            expect((explainTool._meta as ToolMeta | undefined)?.ui).toBeUndefined();

            // The helper only constructs an AppRegistry when the feature is on,
            // so no ui:// resources are registered. (resources/list is not
            // installed at all in this harness when no resources register, so
            // we assert on the server rather than calling it.)
            expect(integration.mcpServer().appRegistry).toBeUndefined();
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: [], // mcpApps is NOT enabled
        }),
    }
);

describeWithMongoDB(
    "mcpApps feature with feature enabled",
    (integration) => {
        it("should advertise ui://explain on the explain tool only", async () => {
            const { tools } = await integration.mcpClient().listTools();

            const explainTool = tools.find((t) => t.name === "explain");
            expectDefined(explainTool);
            expect((explainTool._meta as ToolMeta | undefined)?.ui?.resourceUri).toBe("ui://explain");

            // The mcp-ui dialect surface (list-databases) is a separate feature:
            // it must NOT gain ext-apps metadata.
            const listDatabasesTool = tools.find((t) => t.name === "list-databases");
            expectDefined(listDatabasesTool);
            expect((listDatabasesTool._meta as ToolMeta | undefined)?.ui).toBeUndefined();
        });

        it("should list and serve the ui://explain resource as an MCP App HTML document", async () => {
            const { resources } = await integration.mcpClient().listResources();
            const appResource = resources.find((r) => r.uri === "ui://explain");
            expectDefined(appResource);
            expect(appResource.mimeType).toBe("text/html;profile=mcp-app");

            const result = await integration.mcpClient().readResource({ uri: "ui://explain" });
            expect(result.contents).toHaveLength(1);

            const content = result.contents[0];
            expectDefined(content);
            expect(content.mimeType).toBe("text/html;profile=mcp-app");
            if (!("text" in content)) {
                throw new Error("expected text resource content");
            }
            expect(typeof content.text).toBe("string");
            expect(content.text).toMatch(/^<!doctype html>/i);
        });

        it("should have AppRegistry initialized with the bundled explain app", async () => {
            const server = integration.mcpServer();
            expectDefined(server.appRegistry);

            expect(server.appRegistry.resourceUriFor("explain")).toBe("ui://explain");
            const html = await server.appRegistry.getHtml("explain");
            expectDefined(html);
            expect(html.length).toBeGreaterThan(0);
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: ["mcpApps"], // mcpApps IS enabled
        }),
    }
);

describeWithMongoDB(
    "mcpApps and mcpUI features enabled together",
    (integration) => {
        it("should keep the two dialects independent: explain has no embedded resource, list-databases has no ui metadata", async () => {
            const connectionId = await integration.connectMcpClient();

            const { tools } = await integration.mcpClient().listTools();
            const listDatabasesTool = tools.find((t) => t.name === "list-databases");
            expectDefined(listDatabasesTool);
            expect((listDatabasesTool._meta as ToolMeta | undefined)?.ui).toBeUndefined();

            const explainResponse = await integration.mcpClient().callTool({
                name: "explain",
                arguments: {
                    connectionId,
                    database: "test",
                    collection: "test",
                    method: [{ name: "find", arguments: { filter: {} } }],
                },
            });
            const elements = explainResponse.content as Array<{ type: string }>;
            expect(elements.filter((e) => e.type === "resource")).toHaveLength(0);

            const listResponse = await integration.mcpClient().callTool({
                name: "list-databases",
                arguments: { connectionId },
            });
            const listElements = listResponse.content as Array<{ type: string }>;
            // mcp-ui embedding still works for list-databases
            expect(listElements.filter((e) => e.type === "resource")).toHaveLength(1);
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: ["mcpUI", "mcpApps"],
        }),
    }
);
