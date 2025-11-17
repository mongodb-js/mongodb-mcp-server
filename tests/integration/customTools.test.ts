import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { ToolBase, type ToolArgs } from "../../src/tools/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Session } from "../../src/common/session.js";
import { Server } from "../../src/server.js";
import type { TelemetryToolMetadata } from "../../src/telemetry/types.js";
import { CompositeLogger } from "../../src/common/logger.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "./inMemoryTransport.js";
import { MCPConnectionManager } from "../../src/common/connectionManager.js";
import { DeviceId } from "../../src/helpers/deviceId.js";
import { connectionErrorHandler } from "../../src/common/connectionErrorHandler.js";
import { Keychain } from "../../src/common/keychain.js";
import { Elicitation } from "../../src/elicitation.js";
import { defaultTestConfig, driverOptions } from "./helpers.js";
import { VectorSearchEmbeddingsManager } from "../../src/common/search/vectorSearchEmbeddingsManager.js";
import { defaultCreateAtlasLocalClient } from "../../src/common/atlasLocal.js";

describe("Custom Tools", () => {
    let mcpClient: Client;
    let mcpServer: Server;
    let deviceId: DeviceId;

    beforeAll(async () => {
        const userConfig = { ...defaultTestConfig };

        const clientTransport = new InMemoryTransport();
        const serverTransport = new InMemoryTransport();
        const logger = new CompositeLogger();

        await serverTransport.start();
        await clientTransport.start();

        void clientTransport.output.pipeTo(serverTransport.input);
        void serverTransport.output.pipeTo(clientTransport.input);

        mcpClient = new Client(
            {
                name: "test-client",
                version: "1.2.3",
            },
            {
                capabilities: {},
            }
        );

        const exportsManager = ExportsManager.init(userConfig, logger);

        deviceId = DeviceId.create(logger);
        const connectionManager = new MCPConnectionManager(userConfig, driverOptions, logger, deviceId);

        const session = new Session({
            apiBaseUrl: userConfig.apiBaseUrl,
            apiClientId: userConfig.apiClientId,
            apiClientSecret: userConfig.apiClientSecret,
            logger,
            exportsManager,
            connectionManager,
            keychain: new Keychain(),
            vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(userConfig, connectionManager),
            atlasLocalClient: await defaultCreateAtlasLocalClient(),
        });

        // Mock hasValidAccessToken for tests
        if (!userConfig.apiClientId && !userConfig.apiClientSecret) {
            const mockFn = vi.fn().mockResolvedValue(true);
            session.apiClient.validateAccessToken = mockFn;
        }

        userConfig.telemetry = "disabled";

        const telemetry = Telemetry.create(session, userConfig, deviceId);

        const mcpServerInstance = new McpServer({
            name: "test-server",
            version: "5.2.3",
        });

        const elicitation = new Elicitation({ server: mcpServerInstance.server });

        mcpServer = new Server({
            session,
            userConfig,
            telemetry,
            mcpServer: mcpServerInstance,
            elicitation,
            connectionErrorHandler,
            tools: [CustomGreetingTool, CustomCalculatorTool],
        });

        await mcpServer.connect(serverTransport);
        await mcpClient.connect(clientTransport);
    });

    afterEach(async () => {
        if (mcpServer) {
            await mcpServer.session.disconnect();
        }

        vi.clearAllMocks();
    });

    afterAll(async () => {
        await mcpClient.close();

        await mcpServer.close();

        deviceId.close();
    });

    it("should register custom tools instead of default tools", async () => {
        // Check that custom tools are registered
        const tools = await mcpClient.listTools();
        const customGreetingTool = tools.tools.find((t) => t.name === "custom_greeting");
        const customCalculatorTool = tools.tools.find((t) => t.name === "custom_calculator");

        expect(customGreetingTool).toBeDefined();
        expect(customCalculatorTool).toBeDefined();

        // Check that default tools are NOT registered since we only provided custom tools
        const defaultTool = tools.tools.find((t) => t.name === "list-databases");
        expect(defaultTool).toBeUndefined();
    });

    it("should execute custom tools", async () => {
        const result = await mcpClient.callTool({
            name: "custom_greeting",
            arguments: { name: "World" },
        });

        expect(result.content).toEqual([
            {
                type: "text",
                text: "Hello, World! This is a custom tool.",
            },
        ]);

        const result2 = await mcpClient.callTool({
            name: "custom_calculator",
            arguments: { a: 5, b: 3 },
        });

        expect(result2.content).toEqual([
            {
                type: "text",
                text: "Result: 8",
            },
        ]);

        const result3 = await mcpClient.callTool({
            name: "custom_calculator",
            arguments: { a: 4, b: 7 },
        });

        expect(result3.content).toEqual([
            {
                type: "text",
                text: "Result: 11",
            },
        ]);
    });

    it("should respect tool categories and operation types from custom tools", () => {
        const customGreetingTool = mcpServer.tools.find((t) => t.name === "custom_greeting");
        expect(customGreetingTool?.category).toBe("mongodb");
        expect(customGreetingTool?.operationType).toBe("read");

        const customCalculatorTool = mcpServer.tools.find((t) => t.name === "custom_calculator");
        expect(customCalculatorTool?.category).toBe("mongodb");
        expect(customCalculatorTool?.operationType).toBe("read");
    });
});

/**
 * Example custom tool that can be provided by library consumers
 */
class CustomGreetingTool extends ToolBase {
    name = "custom_greeting";
    category = "mongodb" as const;
    operationType = "read" as const;
    protected description = "A custom tool that greets the user";
    protected argsShape = {
        name: z.string().describe("The name to greet"),
    };

    protected execute({ name }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: `Hello, ${name}! This is a custom tool.`,
                },
            ],
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

/**
 * Another example custom tool that performs a calculation
 */
class CustomCalculatorTool extends ToolBase {
    name = "custom_calculator";
    category = "mongodb" as const;
    operationType = "read" as const;
    protected description = "A custom tool that performs calculations";
    protected argsShape = {
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
    };

    protected execute({ a, b }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: `Result: ${a + b}`,
                },
            ],
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}
