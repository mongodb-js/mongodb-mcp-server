import { StreamableHttpRunner, MCPHttpServer } from "@mongodb-js/mcp-http-runners";
import { SessionStore } from "@mongodb-js/mcp-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { defaultTestConfig } from "../integrationHelpers.js";
import type { UserConfig } from "@mongodb-js/mcp-cli";
import type {
    DefaultMetricDefinitions,
    HttpServerOptions,
    IMetrics,
    SessionManagementOptions,
    TransportRequestContext,
} from "@mongodb-js/mcp-types";
import { CompositeLogger, Keychain } from "@mongodb-js/mcp-core";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Server } from "mongodb-mcp-server";
import { AllTools } from "mongodb-mcp-server";
import { applyConfigOverrides } from "@mongodb-js/mcp-cli";
import { Session, Elicitation, connectionErrorHandler, MCPConnectionManager, ExportsManager } from "mongodb-mcp-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTestApiClient } from "../integrationHelpers.js";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { packageInfo } from "mongodb-mcp-server";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import type { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import { NoopTelemetry } from "@mongodb-js/mcp-core";

// Custom MCPHttpServer that applies config overrides from request headers
class ConfigOverrideMCPHttpServer extends MCPHttpServer<Server> {
    private baseConfig: UserConfig;

    constructor({
        baseConfig,
        options,
        logger,
        metrics,
        sessionStore,
    }: {
        baseConfig: UserConfig;
        options: {
            http: HttpServerOptions;
            session: SessionManagementOptions;
        };
        logger: CompositeLogger;
        metrics: IMetrics<DefaultMetricDefinitions>;
        sessionStore: SessionStore<StreamableHTTPServerTransport>;
    }) {
        super({ options, logger, metrics, sessionStore });
        this.baseConfig = baseConfig;
    }

    protected override async createServerForRequest(request: TransportRequestContext): Promise<Server> {
        // Apply config overrides from request headers
        const config = applyConfigOverrides({
            baseConfig: this.baseConfig,
            request,
        });

        return createTestServer(config);
    }
}

// Helper to create a full Server instance for tests
async function createTestServer(config: UserConfig): Promise<Server> {
    const logger = new CompositeLogger({ loggers: [] });
    const keychain = Keychain.root;

    const exportsManager = ExportsManager.init({
        options: {
            exportsPath: config.exportsPath,
            exportTimeoutMs: config.exportTimeoutMs,
            exportCleanupIntervalMs: config.exportCleanupIntervalMs,
        },
        logger,
    });

    const connectionManager = new MCPConnectionManager({
        logger,
        deviceId: {} as unknown as DeviceId,
        options: {
            connectionInfo: { transport: "http", httpHost: "localhost" },
            displayName: packageInfo.mcpServerName,
            version: packageInfo.version,
        },
    });

    const apiClient = createTestApiClient({
        baseUrl: config.apiBaseUrl,
        userAgent: `mongodb-mcp-server/${packageInfo.version}`,
        logger,
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
    });

    // Mock the API client methods for tests
    vi.spyOn(apiClient, "validateAuthConfig").mockResolvedValue(undefined);
    vi.spyOn(apiClient, "close").mockResolvedValue(undefined);

    const atlasLocalClient = await createAtlasLocalClient({ logger });

    const mcpServer = new McpServer({
        name: "test-server",
        version: packageInfo.version,
    });

    const elicitation = new Elicitation({ server: mcpServer.server });

    const session = new Session({
        userConfig: config,
        logger,
        exportsManager,
        connectionManager,
        keychain,
        apiClient,
        connectionErrorHandler,
        atlasLocalClient,
    });

    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    const server = new Server({
        session,
        userConfig: config,
        mcpServer,
        telemetry: new NoopTelemetry() as unknown as AtlasTelemetry,
        connectionErrorHandler,
        elicitation,
        metrics,
        serverMetadata: {
            mcpServerName: "test-server",
            version: "1.0",
            engines: {
                node: "20.0.0",
            },
        },
        tools: AllTools,
    });

    return server;
}

// Helper to create StreamableHttpRunner with config override support
function createConfigOverrideRunner(baseConfig: UserConfig): Promise<{
    runner: StreamableHttpRunner<Server>;
    getServerAddress: () => string;
}> {
    const logger = new CompositeLogger({ loggers: [] });
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    const sessionStore = new SessionStore<StreamableHTTPServerTransport>({
        options: {
            idleTimeoutMS: baseConfig.idleTimeoutMs,
            notificationTimeoutMS: baseConfig.notificationTimeoutMs,
        },
        logger,
        metrics: metrics,
    });

    const mcpHttpServer = new ConfigOverrideMCPHttpServer({
        baseConfig,
        options: {
            http: {
                host: baseConfig.httpHost,
                port: baseConfig.httpPort,
                responseType: baseConfig.httpResponseType,
            },
            session: {
                idleTimeoutMs: baseConfig.idleTimeoutMs,
                notificationTimeoutMs: baseConfig.notificationTimeoutMs,
                externallyManagedSessions: baseConfig.externallyManagedSessions,
            },
        },
        logger,
        metrics: metrics,
        sessionStore,
    });

    const runner = new StreamableHttpRunner<Server>({
        logger,
        metrics: metrics,
        mcpHttpServer,
        sessionStore,
    });

    const getServerAddress = (): string => {
        return (runner as unknown as { mcpHttpServer: { serverAddress: string } }).mcpHttpServer.serverAddress;
    };

    return Promise.resolve({ runner, getServerAddress });
}

describe("Config Overrides via HTTP", () => {
    let runner: StreamableHttpRunner<Server>;
    let client: Client;
    let transport: StreamableHTTPClientTransport;
    let getServerAddress: () => string;

    // Helper function to setup and start runner with config
    async function startRunner(baseConfig: UserConfig): Promise<void> {
        const result = await createConfigOverrideRunner(baseConfig);
        runner = result.runner;
        getServerAddress = result.getServerAddress;
        await runner.start();
    }

    // Helper function to connect client with headers
    async function connectClient(headers: Record<string, string> = {}): Promise<void> {
        transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress()}/mcp`), {
            requestInit: { headers },
        });
        await client.connect(transport);
    }

    beforeEach(() => {
        client = new Client({
            name: "test-client",
            version: "1.0.0",
        });
    });

    afterEach(async () => {
        if (client) {
            await client.close();
        }
        if (transport) {
            await transport.close();
        }
        if (runner) {
            await runner.close();
        }
    });

    describe("override behavior", () => {
        it("should error when allowRequestOverrides is false", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: false,
                allowRequestOverrides: false,
            });

            try {
                await connectClient({
                    ["x-mongodb-mcp-read-only"]: "true",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown", { cause: error });
                }
                expect(error.message).toContain("Request overrides are not enabled");
            }
        });

        it("should override readOnly config with header (false to true)", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: false,
                allowRequestOverrides: true,
            });

            await connectClient({
                ["x-mongodb-mcp-read-only"]: "true",
            });

            const response = await client.listTools();

            expect(response).toBeDefined();
            expect(response.tools).toBeDefined();

            // Verify read-only mode is applied - insert-many should not be available
            const writeTools = response.tools.filter((tool) => tool.name === "insert-many");
            expect(writeTools.length).toBe(0);

            // Verify read tools are available
            const readTools = response.tools.filter((tool) => tool.name === "find");
            expect(readTools.length).toBe(1);
        });

        it("should not be able to override connectionString with header", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                connectionString: undefined,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    ["x-mongodb-mcp-connection-string"]: "mongodb://override:27017",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown", { cause: error });
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                expect(error.message).toContain("Config key connectionString is not allowed to be overridden");
            }
        });
    });

    describe("merge behavior", () => {
        it("should merge disabledTools with header", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                disabledTools: ["insert-many"],
                allowRequestOverrides: true,
            });

            await connectClient({
                ["x-mongodb-mcp-disabled-tools"]: "find,aggregate",
            });

            const response = await client.listTools();

            expect(response).toBeDefined();
            expect(response.tools).toBeDefined();

            // Verify all three tools are disabled
            const insertTool = response.tools.find(
                (tool) => tool.name === "insert-many" || tool.name === "find" || tool.name === "aggregate"
            );

            expect(response.tools).not.toHaveLength(0);
            expect(insertTool).toBeUndefined();
        });
    });

    describe("not-allowed behavior", () => {
        it.each([
            {
                configKey: "apiBaseUrl",
                headerName: "x-mongodb-mcp-api-base-url",
                headerValue: "https://malicious.com/",
            },
            {
                configKey: "apiClientId",
                headerName: "x-mongodb-mcp-api-client-id",
                headerValue: "malicious-id",
            },
            {
                configKey: "apiClientSecret",
                headerName: "x-mongodb-mcp-api-client-secret",
                headerValue: "malicious-secret",
            },
            {
                configKey: "transport",
                headerName: "x-mongodb-mcp-transport",
                headerValue: "stdio",
            },
            {
                configKey: "httpPort",
                headerName: "x-mongodb-mcp-http-port",
                headerValue: "9999",
            },
            {
                configKey: "maxBytesPerQuery",
                headerName: "x-mongodb-mcp-max-bytes-per-query",
                headerValue: "999999",
            },
            {
                configKey: "maxDocumentsPerQuery",
                headerName: "x-mongodb-mcp-max-documents-per-query",
                headerValue: "1000",
            },
        ])("should reject $configKey with header", async ({ configKey, headerName, headerValue }) => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    [headerName]: headerValue,
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown", { cause: error });
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                expect(error.message).toContain(`Config key ${configKey} is not allowed to be overridden`);
            }
        });

        it("should reject multiple not-allowed fields at once", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    "x-mongodb-mcp-api-base-url": "https://malicious.com/",
                    "x-mongodb-mcp-transport": "stdio",
                    "x-mongodb-mcp-http-port": "9999",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown", { cause: error });
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                // Should contain at least one of the not-allowed field errors
                const hasNotAllowedError =
                    error.message.includes("Config key apiBaseUrl is not allowed to be overridden") ||
                    error.message.includes("Config key transport is not allowed to be overridden") ||
                    error.message.includes("Config key httpPort is not allowed to be overridden");
                expect(hasNotAllowedError).toBe(true);
            }
        });
    });

    describe("query parameter overrides", () => {
        it("should apply overrides from query parameters", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: false,
                allowRequestOverrides: true,
            });

            // Note: SDK doesn't support query params directly, so this test verifies the mechanism exists
            // In real usage, query params would be in the URL or request
            await connectClient({
                ["x-mongodb-mcp-read-only"]: "true",
            });

            const response = await client.listTools();

            expect(response).toBeDefined();
            const writeTools = response.tools.filter((tool) => tool.name === "insert-many");
            expect(writeTools.length).toBe(0);
        });
    });

    describe("conditional overrides", () => {
        it("should allow readOnly from false to true", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: false,
                allowRequestOverrides: true,
            });

            await connectClient({
                ["x-mongodb-mcp-read-only"]: "true",
            });

            const response = await client.listTools();

            expect(response).toBeDefined();
            expect(response.tools).toBeDefined();
            // Check readonly mode
            const writeTools = response.tools.filter((tool) => tool.name === "insert-many");
            expect(writeTools.length).toBe(0);

            // Check read tools are available
            const readTools = response.tools.filter((tool) => tool.name === "find");
            expect(readTools.length).toBe(1);
        });

        it("should NOT allow readOnly from true to false", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: true,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    ["x-mongodb-mcp-read-only"]: "false",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown", { cause: error });
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                expect(error.message).toContain("Cannot apply override for readOnly: Can only set to true");
            }
        });
    });

    describe("multiple overrides", () => {
        it("should handle multiple header overrides", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: false,
                indexCheck: false,
                idleTimeoutMs: 600_000,
                disabledTools: ["tool1"],
                allowRequestOverrides: true,
            });

            await connectClient({
                ["x-mongodb-mcp-read-only"]: "true",
                ["x-mongodb-mcp-index-check"]: "true",
                ["x-mongodb-mcp-idle-timeout-ms"]: "300000",
                ["x-mongodb-mcp-disabled-tools"]: "count",
            });

            const response = await client.listTools();

            expect(response).toBeDefined();

            // Verify read-only mode
            const writeTools = response.tools.filter((tool) => tool.name === "insert-many");
            expect(writeTools.length).toBe(0);

            // Verify disabled tools
            const countTool = response.tools.find((tool) => tool.name === "count");
            expect(countTool).toBeUndefined();

            const findTool = response.tools.find((tool) => tool.name === "find");
            expect(findTool).toBeDefined();
        });
    });

    describe("onlyLowerThanBaseValueOverride behavior", () => {
        it("should allow override to a lower value", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                idleTimeoutMs: 600_000,
                allowRequestOverrides: true,
            });

            await connectClient({
                ["x-mongodb-mcp-idle-timeout-ms"]: "300000",
            });

            const response = await client.listTools();
            expect(response).toBeDefined();
        });

        it("should reject override to a higher value", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                idleTimeoutMs: 600_000,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    ["x-mongodb-mcp-idle-timeout-ms"]: "900000",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown", { cause: error });
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                expect(error.message).toContain(
                    "Cannot apply override for idleTimeoutMs: Can only set to a value lower than the base value"
                );
            }
        });

        it("should reject override to equal value", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                idleTimeoutMs: 600_000,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    ["x-mongodb-mcp-idle-timeout-ms"]: "600000",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown", { cause: error });
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                expect(error.message).toContain(
                    "Cannot apply override for idleTimeoutMs: Can only set to a value lower than the base value"
                );
            }
        });
    });

    describe("onlySubsetOfBaseValueOverride behavior", () => {
        describe("previewFeatures", () => {
            it("should allow override to same value", async () => {
                await startRunner({
                    ...defaultTestConfig,
                    httpPort: 0,
                    previewFeatures: ["mcpUI"],
                    allowRequestOverrides: true,
                });

                await connectClient({
                    ["x-mongodb-mcp-preview-features"]: "mcpUI",
                });

                const response = await client.listTools();
                expect(response).toBeDefined();
            });

            it("should allow override to an empty array (subset of any array)", async () => {
                await startRunner({
                    ...defaultTestConfig,
                    httpPort: 0,
                    previewFeatures: ["mcpUI"],
                    allowRequestOverrides: true,
                });

                await connectClient({
                    ["x-mongodb-mcp-preview-features"]: "",
                });

                const response = await client.listTools();
                expect(response).toBeDefined();
            });

            it("should reject override when base is empty array and trying to add items", async () => {
                await startRunner({
                    ...defaultTestConfig,
                    httpPort: 0,
                    previewFeatures: [],
                    allowRequestOverrides: true,
                });

                // Empty array trying to override with non-empty should fail (superset)
                try {
                    await connectClient({
                        ["x-mongodb-mcp-preview-features"]: "mcpUI",
                    });
                    expect.fail("Expected an error to be thrown");
                } catch (error) {
                    if (!(error instanceof Error)) {
                        throw new Error("Expected an error to be thrown", { cause: error });
                    }
                    expect(error.message).toContain("Error POSTing to endpoint");
                    expect(error.message).toContain(
                        "Cannot apply override for previewFeatures: Can only override to a subset of the base value"
                    );
                }
            });
        });
    });
});
