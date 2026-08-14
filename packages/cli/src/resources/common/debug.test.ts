import { beforeEach, describe, expect, it, vi } from "vitest";
import { DebugResource } from "./debug.js";
import { CompositeLogger, Keychain, McpServer } from "@mongodb-js/mcp-core";
import { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import { ApiClient, userAgentFromServerMetadata } from "@mongodb-js/mcp-atlas-api-client";
import { Session, UserConfigSchema, type UserConfig } from "@mongodb-js/mcp-cli";
import {
    PRECONFIGURED_CONNECTION_ID,
    ExportsManager,
    DeviceId,
    MCPConnectionStore,
    connectionErrorHandler,
    FakeConnectionManager,
    type ConnectionRegistry,
} from "@mongodb-js/mcp-tools-mongodb";

const defaultTestConfig: UserConfig = {
    ...UserConfigSchema.parse({}),
    telemetry: "disabled",
    loggers: ["stderr"],
    connectionScope: "global",
    maxActiveConnections: 10,
};

const testServerMetadata = {
    mcpServerName: "test-server",
    version: "0.0.0",
} as const;

describe("debug resource", () => {
    const logger = new CompositeLogger();
    const deviceId = DeviceId.create(logger);

    let managers: FakeConnectionManager[];
    let session: Session;
    let registry: ConnectionRegistry;
    let debugResource: DebugResource;

    function setup(config: UserConfig = defaultTestConfig): void {
        registry = new MCPConnectionStore({
            userConfig: config,
            logger,
            deviceId,
            createConnectionManager: (): FakeConnectionManager => {
                const manager = new FakeConnectionManager();
                managers.push(manager);
                return manager;
            },
        }).view();

        session = new Session({
            logger,
            exportsManager: ExportsManager.init({ options: config, logger }),
            connectionRegistry: registry,
            keychain: new Keychain(),
            connectionErrorHandler,
            apiClient: new ApiClient(
                {
                    baseUrl: config.apiBaseUrl,
                    userAgent: userAgentFromServerMetadata(testServerMetadata),
                    httpClient: {
                        fetch: globalThis.fetch.bind(globalThis) as typeof fetch,
                        Request: globalThis.Request,
                    },
                },
                logger
            ),
            config,
            userConfig: config,
        });

        const mcpServer = new McpServer({
            name: testServerMetadata.mcpServerName,
            version: testServerMetadata.version,
        });

        const telemetry = AtlasTelemetry.create({
            logger,
            deviceId,
            apiClient: session.apiClient,
            keychain: session.keychain,
            enabled: false,
            serverMetadata: testServerMetadata,
        });

        debugResource = new DebugResource(session, config, telemetry);
    }

    beforeEach(() => {
        managers = [];
        setup();
    });

    it("should enumerate the connect tools when there are no connections", async () => {
        const fakeTools = [
            { name: "connect", category: "mongodb", operationType: "connect", isEnabled: (): boolean => true },
            { name: "disconnect", category: "mongodb", operationType: "connect", isEnabled: (): boolean => true },
            {
                name: "atlas-connect-cluster",
                category: "atlas",
                operationType: "connect",
                isEnabled: (): boolean => true,
            },
            { name: "find", category: "mongodb", operationType: "read", isEnabled: (): boolean => true },
        ];
        (debugResource as unknown as { server: { tools: typeof fakeTools } }).server = { tools: fakeTools };

        const output = await debugResource.toOutput();

        expect(output).toContain(
            'There are no MongoDB connections. Use one of the following tools to establish one and pass the returned connectionId to the MongoDB tools: "atlas-connect-cluster", "connect".'
        );
    });

    it("should point at the configuration when there are no connections and no connect tools", async () => {
        const output = await debugResource.toOutput();

        expect(output).toContain(
            "There are no MongoDB connections and no tools to establish one are enabled. Update the MCP server configuration to include a connection string."
        );
    });

    it("should list a connected entry with its state and description", async () => {
        const entry = await registry.connect({ settings: { connectionString: "mongodb://localhost:27017", driverOptions: {} } });
        vi.spyOn(entry, "isSearchSupported").mockResolvedValue(false);

        const output = await debugResource.toOutput();

        expect(output).toContain("Active MongoDB connections:");
        expect(output).toContain(
            `- "${entry.connectionId}" (connected): MongoDB connection (host type: unknown, auth: scram)`
        );
        expect(output).toContain("Search indexes are not supported.");
    });

    it("should notify if a cluster supports search indexes", async () => {
        const entry = await registry.connect({ settings: { connectionString: "mongodb://localhost:27017", driverOptions: {} } });
        vi.spyOn(entry, "isSearchSupported").mockResolvedValue(true);

        const output = await debugResource.toOutput();

        expect(output).toContain(`- "${entry.connectionId}" (connected)`);
        expect(output).toContain("Search indexes are supported.");
    });

    it("should show the atlas cluster information when provided", async () => {
        const entry = await registry.connect({
            settings: {
                connectionString: "mongodb://localhost:27017",
                driverOptions: {},
                atlas: {
                    clusterName: "My Test Cluster",
                    projectId: "COFFEEFABADA",
                    username: "",
                    instanceType: "FREE",
                    expiryDate: new Date(),
                },
            },
        });
        vi.spyOn(entry, "isSearchSupported").mockResolvedValue(false);

        const output = await debugResource.toOutput();

        expect(output).toContain(
            `- "${entry.connectionId}" (connected): Atlas cluster "My Test Cluster" (project COFFEEFABADA)`
        );
    });

    it("should list the undialed preconfigured connection", async () => {
        setup({ ...defaultTestConfig, connectionString: "mongodb://localhost:27017" });

        const output = await debugResource.toOutput();

        expect(output).toContain(
            `- "${PRECONFIGURED_CONNECTION_ID}" (disconnected): Configured connection string (not yet dialed)`
        );
    });

    it("should contain the last error when a connection attempt failed", async () => {
        setup({ ...defaultTestConfig, connectionString: "mongodb://localhost:27017" });
        expect(managers[0]).toBeDefined();
        (managers[0] as FakeConnectionManager).failNextConnect = new Error("Error message from the server");
        await expect(registry.resolve(PRECONFIGURED_CONNECTION_ID)).rejects.toThrow();

        const output = await debugResource.toOutput();

        expect(output).toContain(`- "${PRECONFIGURED_CONNECTION_ID}" (errored)`);
        expect(output).toContain(`The last connection attempt for "${PRECONFIGURED_CONNECTION_ID}" failed.`);
        expect(output).toContain("<untrusted-user-data-");
        expect(output).toContain("Error message from the server");
    });
});
