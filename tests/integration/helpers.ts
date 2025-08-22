import { CompositeLogger } from "../../src/common/logger.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import { Session } from "../../src/common/session.js";
import { Server } from "../../src/server.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "./inMemoryTransport.js";
import { UserConfig, DriverOptions } from "../../src/common/config.js";
import { McpError, ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { config, driverOptions } from "../../src/common/config.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ConnectionManager, ConnectionState } from "../../src/common/connectionManager.js";
import { DeviceId } from "../../src/helpers/deviceId.js";

interface ParameterInfo {
    name: string;
    type: string;
    description: string;
    required: boolean;
}

type ToolInfo = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

export interface IntegrationTest {
    mcpClient: () => Client;
    mcpServer: () => Server;
}
export const defaultTestConfig: UserConfig = {
    ...config,
    telemetry: "disabled",
    loggers: ["stderr"],
};

export const defaultDriverOptions: DriverOptions = {
    ...driverOptions,
};

export function setupIntegrationTest(
    getUserConfig: () => UserConfig,
    getDriverOptions: () => DriverOptions
): IntegrationTest {
    let mcpClient: Client | undefined;
    let mcpServer: Server | undefined;
    let deviceId: DeviceId | undefined;

    beforeAll(async () => {
        const userConfig = getUserConfig();
        const driverOptions = getDriverOptions();

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
        const connectionManager = new ConnectionManager(userConfig, driverOptions, logger, deviceId);

        const session = new Session({
            apiBaseUrl: userConfig.apiBaseUrl,
            apiClientId: userConfig.apiClientId,
            apiClientSecret: userConfig.apiClientSecret,
            logger,
            exportsManager,
            connectionManager,
        });

        // Mock hasValidAccessToken for tests
        if (userConfig.apiClientId && userConfig.apiClientSecret) {
            const mockFn = vi.fn().mockResolvedValue(true);
            session.apiClient.validateAccessToken = mockFn;
        }

        userConfig.telemetry = "disabled";

        const telemetry = Telemetry.create(session, userConfig, deviceId);

        mcpServer = new Server({
            session,
            userConfig,
            telemetry,
            mcpServer: new McpServer({
                name: "test-server",
                version: "5.2.3",
            }),
        });

        await mcpServer.connect(serverTransport);
        await mcpClient.connect(clientTransport);
    });

    afterEach(async () => {
        if (mcpServer) {
            await mcpServer.session.disconnect();
        }
    });

    afterAll(async () => {
        await mcpClient?.close();
        mcpClient = undefined;

        await mcpServer?.close();
        mcpServer = undefined;

        deviceId?.close();
        deviceId = undefined;
    });

    const getMcpClient = (): Client => {
        if (!mcpClient) {
            throw new Error("beforeEach() hook not ran yet");
        }

        return mcpClient;
    };

    const getMcpServer = (): Server => {
        if (!mcpServer) {
            throw new Error("beforeEach() hook not ran yet");
        }

        return mcpServer;
    };

    return {
        mcpClient: getMcpClient,
        mcpServer: getMcpServer,
    };
}

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export function getResponseContent(content: unknown | { content: unknown }): string {
    return getResponseElements(content)
        .map((item) => item.text)
        .join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export function getResponseElements(content: unknown | { content: unknown }): { type: string; text: string }[] {
    if (typeof content === "object" && content !== null && "content" in content) {
        content = (content as { content: unknown }).content;
    }

    expect(content).toBeInstanceOf(Array);

    const response = content as { type: string; text: string }[];
    for (const item of response) {
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("text");
        expect(item.type).toBe("text");
    }

    return response;
}

export async function connect(client: Client, connectionString: string): Promise<void> {
    await client.callTool({
        name: "connect",
        arguments: { connectionStringOrClusterName: connectionString },
    });
}

export function getParameters(tool: ToolInfo): ParameterInfo[] {
    expect(tool.inputSchema.type).toBe("object");
    expectDefined(tool.inputSchema.properties);

    return Object.entries(tool.inputSchema.properties)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => {
            expect(value).toHaveProperty("type");
            expect(value).toHaveProperty("description");

            const typedValue = value as { type: string; description: string };
            expect(typeof typedValue.type).toBe("string");
            expect(typeof typedValue.description).toBe("string");
            return {
                name: key,
                type: typedValue.type,
                description: typedValue.description,
                required: (tool.inputSchema.required as string[])?.includes(key) ?? false,
            };
        });
}

export const databaseParameters: ParameterInfo[] = [
    { name: "database", type: "string", description: "Database name", required: true },
];

export const databaseCollectionParameters: ParameterInfo[] = [
    ...databaseParameters,
    { name: "collection", type: "string", description: "Collection name", required: true },
];

export const databaseCollectionInvalidArgs = [
    {},
    { database: "test" },
    { collection: "foo" },
    { database: 123, collection: "foo" },
    { database: "test", collection: 123 },
    { database: [], collection: "foo" },
    { database: "test", collection: [] },
];

export const databaseInvalidArgs = [{}, { database: 123 }, { database: [] }];

export function validateToolMetadata(
    integration: IntegrationTest,
    name: string,
    description: string,
    parameters: ParameterInfo[]
): void {
    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const tool = tools.find((tool) => tool.name === name);
        expectDefined(tool);
        expect(tool.description).toBe(description);

        validateToolAnnotations(tool, name, description);
        const toolParameters = getParameters(tool);
        expect(toolParameters).toHaveLength(parameters.length);
        expect(toolParameters).toIncludeSameMembers(parameters);
    });
}

export function validateThrowsForInvalidArguments(
    integration: IntegrationTest,
    name: string,
    args: { [x: string]: unknown }[]
): void {
    describe("with invalid arguments", () => {
        for (const arg of args) {
            it(`throws a schema error for: ${JSON.stringify(arg)}`, async () => {
                try {
                    await integration.mcpClient().callTool({ name, arguments: arg });
                    throw new Error("Expected an error to be thrown");
                } catch (error) {
                    expect((error as Error).message).not.toEqual("Expected an error to be thrown");
                    expect(error).toBeInstanceOf(McpError);
                    const mcpError = error as McpError;
                    expect(mcpError.code).toEqual(-32602);
                    expect(mcpError.message).toContain(`Invalid arguments for tool ${name}`);
                }
            });
        }
    });
}

/** Expects the argument being defined and asserts it */
export function expectDefined<T>(arg: T): asserts arg is Exclude<T, undefined | null> {
    expect(arg).toBeDefined();
    expect(arg).not.toBeNull();
}

function validateToolAnnotations(tool: ToolInfo, name: string, description: string): void {
    expectDefined(tool.annotations);
    expect(tool.annotations.title).toBe(name);
    expect(tool.annotations.description).toBe(description);

    switch (tool.operationType) {
        case "read":
        case "metadata":
            expect(tool.annotations.readOnlyHint).toBe(true);
            expect(tool.annotations.destructiveHint).toBe(false);
            break;
        case "delete":
            expect(tool.annotations.readOnlyHint).toBe(false);
            expect(tool.annotations.destructiveHint).toBe(true);
            break;
        case "create":
        case "update":
            expect(tool.annotations.readOnlyHint).toBe(false);
            expect(tool.annotations.destructiveHint).toBe(false);
    }
}

export function timeout(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Subscribes to the resources changed notification for the provided URI
 */
export function resourceChangedNotification(client: Client, uri: string): Promise<void> {
    return new Promise<void>((resolve) => {
        void client.subscribeResource({ uri });
        client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
            if (notification.params.uri === uri) {
                resolve();
            }
        });
    });
}

export function responseAsText(response: Awaited<ReturnType<Client["callTool"]>>): string {
    return JSON.stringify(response.content, undefined, 2);
}

export function waitUntil<T extends ConnectionState>(
    tag: T["tag"],
    cm: ConnectionManager,
    signal: AbortSignal,
    additionalCondition?: (state: T) => boolean
): Promise<T> {
    let ts: NodeJS.Timeout | undefined;

    return new Promise<T>((resolve, reject) => {
        ts = setInterval(() => {
            if (signal.aborted) {
                return reject(new Error(`Aborted: ${signal.reason}`));
            }

            const status = cm.currentConnectionState;
            if (status.tag === tag) {
                if (!additionalCondition || (additionalCondition && additionalCondition(status as T))) {
                    return resolve(status as T);
                }
            }
        }, 100);
    }).finally(() => {
        if (ts !== undefined) {
            clearInterval(ts);
        }
    });
}
