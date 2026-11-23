import { MongoClient, type MongoClient as MongoClientType } from "mongodb";
import { MongoDBClusterProcess, startMockTelemetryServer, type MockTelemetryServer } from "@mongodb-js/mcp-test-utils";
import { afterAll, beforeAll } from "vitest";
import { useAgent, type AgentHarness, type AgentHarnessOptions } from "@mongodb-js/harness-tester";
import type { AllTools } from "mongodb-mcp-server";
import type { InProcessServer } from "./inProcessServer.js";
import { startInProcessServer } from "./inProcessServer.js";

export interface AgentE2EContext {
    harness: AgentHarness;
    connectionString: () => string;
    workDir: () => string;
    serverUrl: () => string;
    mongoClient: () => MongoClientType;
    /** Unique database name for this test file. */
    dbName: string;
    /** Mock telemetry endpoint the server sends to, when `telemetry` is enabled. */
    telemetryServer: () => MockTelemetryServer | undefined;
    buildOptions: (overrides?: Partial<AgentHarnessOptions>) => AgentHarnessOptions;
}

/**
 * Composes the agent-only `useAgent` hook with a local mongod (no docker) and
 * the in-process MongoDB MCP server (`startInProcessServer`) the agent connects
 * to by URL, plus connection/db accessors. With `telemetry`, the server sends
 * telemetry to a local mock endpoint.
 */
export function useMcpAgent({
    harness,
    tools,
    telemetry = false,
}: {
    harness: AgentHarness;
    tools?: typeof AllTools;
    telemetry?: boolean;
}): AgentE2EContext {
    const base = useAgent({ harness });
    let cluster: MongoDBClusterProcess | undefined;
    let server: InProcessServer | undefined;
    let telemetryServer: MockTelemetryServer | undefined;
    let connectionString = "";
    let mongoClient: MongoClientType | undefined;
    const dbName = `agent_e2e_${process.pid}_${Date.now().toString(36)}`;

    beforeAll(async () => {
        if (!base.isHarnessAvailable()) {
            return;
        }
        if (telemetry) {
            telemetryServer = await startMockTelemetryServer();
        }
        cluster = await MongoDBClusterProcess.spinUp({
            runner: true,
            downloadOptions: { enterprise: false },
            serverArgs: [],
        });
        connectionString = cluster.connectionString();
        server = await startInProcessServer(
            {
                connectionString,
                ...(telemetryServer ? { telemetry: "enabled", telemetryBaseUrl: telemetryServer.baseUrl } : {}),
            },
            tools
        );
    }, 120_000);

    afterAll(async () => {
        await mongoClient?.close();
        // Close the server first so its telemetry flushes to the still-running mock.
        await server?.close();
        await telemetryServer?.close();
        await cluster?.close();
    });

    return {
        harness,
        connectionString: () => connectionString,
        workDir: base.workDir,
        serverUrl: () => server?.url ?? "",
        mongoClient: (): MongoClient => {
            if (!mongoClient) {
                mongoClient = new MongoClient(connectionString);
            }
            return mongoClient;
        },
        dbName,
        telemetryServer: () => telemetryServer,
        // In-process server first, then agent-only defaults; test overrides win.
        buildOptions: (overrides = {}) => ({
            serverUrl: server?.url,
            mcpServerName: "mongo",
            ...base.buildOptions(),
            ...overrides,
        }),
    } satisfies AgentE2EContext;
}
