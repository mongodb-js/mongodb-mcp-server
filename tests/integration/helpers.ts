import type { LoggerType, LogLevel, LogPayload } from "../../src/common/logger.js";
import { CompositeLogger, LoggerBase } from "../../src/common/logger.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import { Session } from "../../src/common/session.js";
import { Server, type ServerOptions } from "../../src/server.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "../../src/transports/inMemoryTransport.js";
import { type UserConfig } from "../../src/common/config/userConfig.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ConnectionManager, ConnectionState } from "../../src/common/connectionManager.js";
import { MCPConnectionManager } from "../../src/common/connectionManager.js";
import { DeviceId } from "../../src/helpers/deviceId.js";
import { connectionErrorHandler } from "../../src/common/connectionErrorHandler.js";
import { Keychain } from "../../src/common/keychain.js";
import { Elicitation } from "../../src/elicitation.js";
import type { MockClientCapabilities, createMockElicitInput } from "../utils/elicitationMocks.js";
import { VectorSearchEmbeddingsManager } from "../../src/common/search/vectorSearchEmbeddingsManager.js";
import { defaultCreateAtlasLocalClient } from "../../src/common/atlasLocal.js";
import { UserConfigSchema } from "../../src/common/config/userConfig.js";
import type { OperationType } from "../../src/tools/tool.js";
import { type ApiClient } from "../../src/common/atlas/apiClient.js";

interface Parameter {
    name: string;
    description: string;
    required: boolean;
}

interface SingleValueParameter extends Parameter {
    type: string;
}

interface AnyOfParameter extends Parameter {
    anyOf: { type: string }[];
}

type ParameterInfo = SingleValueParameter | AnyOfParameter;

type ToolInfo = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

export interface IntegrationTest {
    mcpClient: () => Client;
    mcpServer: () => Server & {
        getApiClient: () => ApiClient;
    };
}
export const defaultTestConfig: UserConfig = {
    ...UserConfigSchema.parse({}),
    telemetry: "disabled",
    loggers: ["stderr"],
};

export const DEFAULT_LONG_RUNNING_TEST_WAIT_TIMEOUT_MS = 1_200_000;

export function setupIntegrationTest(
    getUserConfig: () => UserConfig,
    {
        elicitInput,
        getClientCapabilities,
        serverOptions,
    }: {
        elicitInput?: ReturnType<typeof createMockElicitInput>;
        getClientCapabilities?: () => MockClientCapabilities;
        serverOptions?: Partial<ServerOptions>;
    } = {}
): IntegrationTest {
    let mcpClient: Client | undefined;
    let mcpServer: Server | undefined;
    let deviceId: DeviceId | undefined;

    beforeAll(async () => {
        const userConfig = getUserConfig();
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
        const connectionManager = new MCPConnectionManager(userConfig, logger, deviceId);

        const session = new Session({
            userConfig,
            logger,
            exportsManager,
            connectionManager,
            keychain: new Keychain(),
            vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(userConfig, connectionManager),
            atlasLocalClient: await defaultCreateAtlasLocalClient({ logger }),
        });

        // Mock hasValidAccessToken for tests
        if (!userConfig.apiClientId && !userConfig.apiClientSecret) {
            const mockFn = vi.fn().mockResolvedValue(undefined);
            const mockCloseFn = vi.fn().mockResolvedValue(undefined);
            Object.defineProperty(session, "apiClient", {
                value: {
                    validateAuthConfig: mockFn,
                    close: mockCloseFn,
                } as unknown as ApiClient,
            });
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

        let uiRegistry = serverOptions?.uiRegistry;
        if (!uiRegistry && userConfig.previewFeatures.includes("mcpUI")) {
            const { UIRegistry } = await import("../../src/ui/registry/registry.js");
            uiRegistry = new UIRegistry();
        }

        mcpServer = new Server({
            session,
            userConfig,
            telemetry,
            mcpServer: mcpServerInstance,
            elicitation,
            connectionErrorHandler,
            uiRegistry,
            ...serverOptions,
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

    const getMcpServer = (): Server & { getApiClient: () => ApiClient } => {
        if (!mcpServer) {
            throw new Error("beforeEach() hook not ran yet");
        }

        return {
            ...mcpServer,
            getApiClient: (): ApiClient => {
                if (!mcpServer || !mcpServer.session.apiClient) {
                    throw new Error("apiClient not available");
                }
                return mcpServer.session.apiClient;
            },
        } as Server & { getApiClient: () => ApiClient };
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
        .map(([name, value]) => {
            expect(value).toHaveProperty("description");

            const description = (value as { description: string }).description;
            const required = (tool.inputSchema.required as string[])?.includes(name) ?? false;
            expect(typeof description).toBe("string");

            if (value && typeof value === "object" && "anyOf" in value) {
                const typedOptions = new Array<{ type: string }>();
                for (const option of value.anyOf as { type: string }[]) {
                    expect(option).toHaveProperty("type");

                    typedOptions.push({ type: option.type });
                }

                return {
                    name,
                    anyOf: typedOptions,
                    description: description,
                    required,
                };
            }

            expect(value).toHaveProperty("type");

            const type = (value as { type: string }).type;
            expect(typeof type).toBe("string");
            return {
                name,
                type,
                description,
                required,
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
    operationType: OperationType,
    parameters: ParameterInfo[]
): void {
    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const tool = tools.find((tool) => tool.name === name);
        expectDefined(tool);
        expect(tool.description).toBe(description);

        validateToolAnnotations(tool, name, operationType);
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
                const result = await integration.mcpClient().callTool({ name, arguments: arg });
                expect(result.isError).toBe(true);
                const message = getResponseContent(result.content);
                expect(message).toContain("-32602");
                expect(message).toContain(`Invalid arguments for tool ${name}`);
            });
        }
    });
}

/** Expects the argument being defined and asserts it */
export function expectDefined<T>(arg: T): asserts arg is Exclude<T, undefined | null> {
    expect(arg).toBeDefined();
    expect(arg).not.toBeNull();
}

function validateToolAnnotations(tool: ToolInfo, name: string, operationType: OperationType): void {
    expectDefined(tool.annotations);
    expect(tool.annotations.title).toBe(name);

    switch (operationType) {
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
            break;
        case "connect":
            break;
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

export class InMemoryLogger extends LoggerBase {
    protected type?: LoggerType = "console";
    public messages: { level: LogLevel; payload: LogPayload }[] = [];
    protected logCore(level: LogLevel, payload: LogPayload): void {
        this.messages.push({ level, payload });
    }
}
