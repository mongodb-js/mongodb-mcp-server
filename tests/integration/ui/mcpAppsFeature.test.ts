import { describe, expect, it, afterAll } from "vitest";
import { describeWithMongoDB } from "../tools/mongodb/mongodbHelpers.js";
import { defaultTestConfig, expectDefined } from "../helpers.js";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { ExportsManager } from "../../../src/common/exportsManager.js";
import { Session } from "../../../src/common/session.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "../../../src/server.js";
import { MCPConnectionManager } from "../../../src/common/connectionManager.js";
import { DeviceId } from "../../../src/helpers/deviceId.js";
import { connectionErrorHandler } from "../../../src/common/connectionErrorHandler.js";
import { Keychain } from "@mongodb-js/mcp-core";
import { Elicitation } from "../../../src/elicitation.js";
import { createAtlasLocalClient } from "../../../src/lib.js";
import { InMemoryTransport } from "../../../src/transports/inMemoryTransport.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { AppRegistry } from "@mongodb-js/mcp-apps";
import { ApiClient } from "../../../src/lib.js";
import { AtlasTelemetry, buildMachineMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { MockMetrics } from "../../unit/mocks/metrics.js";

describeWithMongoDB(
    "mcpApps feature with feature disabled (default)",
    (integration) => {
        it("should NOT register any app resources or tools when mcpApps feature is disabled", async () => {
            await integration.connectMcpClient();
            const { resources } = await integration.mcpClient().listResources();
            const appResources = resources.filter((r) => r.uri.startsWith("ui://connect-form"));
            expect(appResources).toHaveLength(0);
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: [],
        }),
    }
);

describeWithMongoDB(
    "mcpApps feature with feature enabled",
    (integration) => {
        it("should register connect-form as a ui:// resource", async () => {
            await integration.connectMcpClient();
            const { resources } = await integration.mcpClient().listResources();
            const connectForm = resources.find((r) => r.uri === "ui://connect-form");
            expectDefined(connectForm);
            expect(connectForm.mimeType).toBe("text/html;profile=mcp-app");
        });

        it("should return HTML content when reading ui://connect-form", async () => {
            await integration.connectMcpClient();
            const result = await integration.mcpClient().readResource({ uri: "ui://connect-form" });

            expect(result.contents).toHaveLength(1);
            const content = result.contents[0];
            expectDefined(content);
            expect(content.mimeType).toBe("text/html;profile=mcp-app");
            expect("text" in content).toBe(true);

            const html = (content as { text: string }).text;
            expect(html.length).toBeGreaterThan(0);
            expect(html).toContain("<!doctype html>");
        });

        it("should register a connect-form tool with ui.resourceUri metadata", async () => {
            await integration.connectMcpClient();
            const { tools } = await integration.mcpClient().listTools();
            const appTool = tools.find((t) => t.name === "connect-form");
            expectDefined(appTool);

            const meta = appTool._meta as { ui?: { resourceUri?: string } } | undefined;
            expectDefined(meta?.ui?.resourceUri);
            expect(meta?.ui?.resourceUri).toBe("ui://connect-form");
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: ["mcpApps"],
        }),
    }
);

describeWithMongoDB(
    "mcpApps feature - AppRegistry initialization",
    (integration) => {
        it("should have AppRegistry initialized with bundled apps", async () => {
            const server = integration.mcpServer();
            expectDefined(server.appRegistry);

            const html = await server.appRegistry.get("connect-form");
            expectDefined(html);
            expect(html).not.toBeNull();
            expect(html.length).toBeGreaterThan(0);
        });

        it("should list connect-form in appNames", () => {
            const server = integration.mcpServer();
            expectDefined(server.appRegistry);
            expect(server.appRegistry.appNames()).toContain("connect-form");
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: ["mcpApps"],
        }),
    }
);

describe("mcpApps feature with custom AppRegistry", () => {
    const initServerWithCustomApps = async (
        customLoaders: Record<string, () => Promise<string>>
    ): Promise<{ server: Server; transport: Transport }> => {
        const userConfig = {
            ...defaultTestConfig,
            previewFeatures: ["mcpApps" as const],
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
            connectionErrorHandler,
            atlasLocalClient: await createAtlasLocalClient({ logger }),
            apiClient: new ApiClient({
                baseUrl: userConfig.apiBaseUrl,
                credentials: {
                    clientId: userConfig.apiClientId,
                    clientSecret: userConfig.apiClientSecret,
                },
                userAgent: "test",
                logger,
            }),
        });

        const telemetry = AtlasTelemetry.create({
            logger,
            deviceId,
            apiClient: session.apiClient,
            keychain: session.keychain,
            enabled: false,
            machineMetadata: buildMachineMetadata("test-server", "0.0.0"),
        });
        const mcpServerInstance = new McpServer({ name: "test", version: "1.0" });
        const elicitation = new Elicitation({ server: mcpServerInstance.server });

        const server = new Server({
            session,
            userConfig,
            telemetry,
            mcpServer: mcpServerInstance,
            elicitation,
            connectionErrorHandler,
            appRegistry: new AppRegistry({ loaders: customLoaders }),
            metrics: new MockMetrics(),
        });

        const transport = new InMemoryTransport();
        return { server, transport };
    };

    let server: Server | undefined;
    let transport: Transport | undefined;

    afterAll(async () => {
        await transport?.close();
        await server?.close();
    });

    it("should register custom app loaders as resources", async () => {
        const customLoaders = {
            "my-app": (): Promise<string> => Promise.resolve("<html><body>My Custom App</body></html>"),
        };

        ({ server, transport } = await initServerWithCustomApps(customLoaders));
        await server.connect(transport);

        expectDefined(server.appRegistry);
        const html = await server.appRegistry.get("my-app");
        expect(html).toBe("<html><body>My Custom App</body></html>");
    });
});
