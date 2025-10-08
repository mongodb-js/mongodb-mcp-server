import { CompositeLogger } from "../../src/common/logger.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import { Session } from "../../src/common/session.js";
import { Server } from "../../src/server.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "./inMemoryTransport.js";
import type { UserConfig, DriverOptions } from "../../src/common/config.js";
import { McpError, ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import {
    config,
    setupDriverConfig,
    defaultDriverOptions as defaultDriverOptionsFromConfig,
} from "../../src/common/config.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ConnectionManager, ConnectionState } from "../../src/common/connectionManager.js";
import { MCPConnectionManager } from "../../src/common/connectionManager.js";
import { DeviceId } from "../../src/helpers/deviceId.js";
import { connectionErrorHandler } from "../../src/common/connectionErrorHandler.js";
import { Keychain } from "../../src/common/keychain.js";
import { Elicitation } from "../../src/elicitation.js";
import type { MockClientCapabilities, createMockElicitInput } from "../utils/elicitationMocks.js";

export const driverOptions = setupDriverConfig({
    config,
    defaults: defaultDriverOptionsFromConfig,
});

export const defaultDriverOptions: DriverOptions = { ...driverOptions };

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

export function setupIntegrationTest(
    getUserConfig: () => UserConfig,
    getDriverOptions: () => DriverOptions,
    {
        elicitInput,
        getClientCapabilities,
    }: {
        elicitInput?: ReturnType<typeof createMockElicitInput>;
        getClientCapabilities?: () => MockClientCapabilities;
    } = {}
): IntegrationTest {
    let mcpClient: Client | undefined;
    let mcpServer: Server | undefined;
    let deviceId: DeviceId | undefined;

    beforeAll(async () => {
        const userConfig = getUserConfig();
        const driverOptions = getDriverOptions();
        const clientCapabilities = getClientCapabilities?.() ?? (elicitInput ? { elicitation: {} } : {});

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
                capabilities: clientCapabilities,
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
        });

        // Mock API Client for tests
        if (!userConfig.apiClientId && !userConfig.apiClientSecret) {
            userConfig.apiClientId = "test";
            userConfig.apiClientSecret = "test";
            const mockFn = vi.fn().mockResolvedValue(true);
            session.apiClient.validateAccessToken = mockFn;
        }

        userConfig.telemetry = "disabled";

        const telemetry = Telemetry.create(session, userConfig, deviceId);

        const mcpServerInstance = new McpServer({
            name: "test-server",
            version: "5.2.3",
        });

        // Mock elicitation if provided
        if (elicitInput) {
            Object.assign(mcpServerInstance.server, { elicitInput: elicitInput.mock });
        }

        const elicitation = new Elicitation({ server: mcpServerInstance.server });

        mcpServer = new Server({
            session,
            userConfig,
            telemetry,
            mcpServer: mcpServerInstance,
            elicitation,
            connectionErrorHandler,
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

export const projectIdParameters: ParameterInfo[] = [
    { name: "projectId", type: "string", description: "Atlas project ID", required: true },
];

export const createClusterParameters: ParameterInfo[] = [
    { name: "projectId", type: "string", description: "Atlas project ID", required: true },
    { name: "clusterName", type: "string", description: "Atlas cluster name", required: true },
    { name: "region", type: "string", description: "Region of the cluster", required: false },
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

export const projectIdInvalidArgs = [
    {},
    { projectId: 123 },
    { projectId: [] },
    { projectId: "!✅invalid" },
    { projectId: "invalid-test-project-id" },
];

export const clusterNameInvalidArgs = [
    { clusterName: 123 },
    { clusterName: [] },
    { clusterName: "!✅invalid" },
    { clusterName: "a".repeat(65) }, // too long
];

export const projectAndClusterInvalidArgs = [
    {},
    { projectId: "507f1f77bcf86cd799439011" }, // missing clusterName
    { clusterName: "testCluster" }, // missing projectId
    { projectId: 123, clusterName: "testCluster" },
    { projectId: "507f1f77bcf86cd799439011", clusterName: 123 },
    { projectId: "invalid", clusterName: "testCluster" },
    { projectId: "507f1f77bcf86cd799439011", clusterName: "!✅invalid" },
];

export const organizationIdInvalidArgs = [
    { organizationId: 123 },
    { organizationId: [] },
    { organizationId: "!✅invalid" },
    { organizationId: "invalid-test-org-id" },
];

export const orgIdInvalidArgs = [
    { orgId: 123 },
    { orgId: [] },
    { orgId: "!✅invalid" },
    { orgId: "invalid-test-org-id" },
];

export const usernameInvalidArgs = [
    {},
    { username: 123 },
    { username: [] },
    { username: "!✅invalid" },
    { username: "a".repeat(101) }, // too long
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

export function getDataFromUntrustedContent(content: string): string {
    const regex = /^[ \t]*<untrusted-user-data-[0-9a-f\\-]*>(?<data>.*)^[ \t]*<\/untrusted-user-data-[0-9a-f\\-]*>/gms;
    const match = regex.exec(content);
    if (!match || !match.groups || !match.groups.data) {
        throw new Error("Could not find untrusted user data in content");
    }
    return match.groups.data.trim();
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
