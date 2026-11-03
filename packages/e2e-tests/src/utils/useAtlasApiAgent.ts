import { afterAll, beforeAll } from "vitest";
import { useAgent, type AgentHarness, type AgentHarnessOptions } from "@mongodb-js/harness-tester";
import type { InProcessServer } from "./inProcessServer.js";
import { startInProcessServer } from "./inProcessServer.js";

// CI maps the repo's TEST_ATLAS_* secrets onto these AGENT_E2E_ATLAS_* vars.
const ATLAS_CLIENT_ID = process.env.AGENT_E2E_ATLAS_CLIENT_ID ?? "";
const ATLAS_CLIENT_SECRET = process.env.AGENT_E2E_ATLAS_CLIENT_SECRET ?? "";
// Same default as the Atlas integration tests, which use these credentials.
const ATLAS_BASE_URL = process.env.AGENT_E2E_ATLAS_BASE_URL ?? "https://cloud-dev.mongodb.com";

export function hasAtlasApiCreds(): boolean {
    return !!ATLAS_CLIENT_ID && !!ATLAS_CLIENT_SECRET;
}

export interface AtlasApiE2EContext {
    harness: AgentHarness;
    workDir: () => string;
    serverUrl: () => string;
    isHarnessAvailable: () => boolean;
    buildOptions: (overrides?: Partial<AgentHarnessOptions>) => AgentHarnessOptions;
}

/**
 * Composes the agent-only `useAgent` hook with an in-process MCP server started
 * with Atlas API credentials and no connection string — no mongod is spun up.
 */
export function useAtlasApiAgent({ harness }: { harness: AgentHarness }): AtlasApiE2EContext {
    const base = useAgent({ harness });
    let server: InProcessServer | undefined;

    beforeAll(async () => {
        if (!base.isHarnessAvailable() || !hasAtlasApiCreds()) {
            return;
        }
        server = await startInProcessServer({
            apiClientId: ATLAS_CLIENT_ID,
            apiClientSecret: ATLAS_CLIENT_SECRET,
            apiBaseUrl: ATLAS_BASE_URL,
        });
    }, 120_000);

    afterAll(async () => {
        await server?.close();
    });

    return {
        harness,
        workDir: base.workDir,
        serverUrl: () => server?.url ?? "",
        isHarnessAvailable: base.isHarnessAvailable,
        // In-process server first, then agent-only defaults; test overrides win.
        buildOptions: (overrides = {}) => ({
            serverUrl: server?.url,
            mcpServerName: "mongo",
            ...base.buildOptions(),
            ...overrides,
        }),
    } satisfies AtlasApiE2EContext;
}
