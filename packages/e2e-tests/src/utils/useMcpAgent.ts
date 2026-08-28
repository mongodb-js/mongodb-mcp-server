import { MongoClient, type MongoClient as MongoClientType } from "mongodb";
import { MongoDBClusterProcess } from "@mongodb-js/mcp-test-utils";
import { afterAll, beforeAll } from "vitest";
import { useAgent, type AgentHarness, type AgentHarnessOptions } from "@mongodb-js/harness-tester";
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
    /** Produce a full AgentHarnessOptions for the harness session. */
    buildOptions: (overrides?: Partial<AgentHarnessOptions>) => AgentHarnessOptions;
}

/**
 * MCP-aware setup for an agent e2e suite: composes the agent-only hook from
 * `@mongodb-js/harness-tester` with the MongoDB-specific pieces the happy-path
 * tests need — a local mongod (`MongoDBClusterProcess`, no docker) and the
 * in-process MongoDB MCP server (`startInProcessServer`) the agent connects to
 * by URL. The agent hook owns the workdir + availability skip gate; this hook
 * only adds the mongod/server lifecycle and the connection/db accessors.
 */
export function useMcpAgent({ harness }: { harness: AgentHarness }): AgentE2EContext {
    const base = useAgent({ harness });
    let cluster: MongoDBClusterProcess | undefined;
    let server: InProcessServer | undefined;
    let connectionString = "";
    let mongoClient: MongoClientType | undefined;
    const dbName = `agent_e2e_${process.pid}_${Date.now().toString(36)}`;

    beforeAll(async () => {
        if (!base.isHarnessAvailable()) {
            return;
        }
        cluster = await MongoDBClusterProcess.spinUp({
            runner: true,
            downloadOptions: { enterprise: false },
            serverArgs: [],
        });
        connectionString = cluster.connectionString();
        server = await startInProcessServer(connectionString);
    }, 120_000);

    afterAll(async () => {
        await mongoClient?.close();
        await server?.close();
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
        // Wiring the agent to the in-process MCP server, then the agent-only
        // defaults (workdir, model, timeout); test overrides win.
        buildOptions: (overrides = {}) => ({
            serverUrl: server?.url,
            mcpServerName: "mongo",
            ...base.buildOptions(),
            ...overrides,
        }),
    } satisfies AgentE2EContext;
}
