import { afterAll, beforeAll } from "vitest";
import { startMockTelemetryServer, type MockTelemetryServer } from "@mongodb-js/mcp-test-utils";
import { useAgent, type AgentHarness, type AgentHarnessOptions } from "@mongodb-js/harness-tester";
import { AllTools } from "mongodb-mcp-server";
import type { InProcessServer } from "./inProcessServer.js";
import { startInProcessServer } from "./inProcessServer.js";

// CI maps the repo's TEST_ATLAS_* secrets onto these AGENT_E2E_ATLAS_* vars.
const ATLAS_CLIENT_ID = process.env.AGENT_E2E_ATLAS_CLIENT_ID ?? "";
const ATLAS_CLIENT_SECRET = process.env.AGENT_E2E_ATLAS_CLIENT_SECRET ?? "";
// Same default as the Atlas integration tests, which use these credentials. `||` (not `??`)
// because CI exports an unset TEST_ATLAS_BASE_URL as an empty string.
const ATLAS_BASE_URL = process.env.AGENT_E2E_ATLAS_BASE_URL || "https://cloud-dev.mongodb.com";

export function hasAtlasApiCreds(): boolean {
    return !!ATLAS_CLIENT_ID && !!ATLAS_CLIENT_SECRET;
}

// Read-only tools only: the harnesses auto-approve tool calls, so exposing
// mutating tools could create real Atlas resources with the test credentials.
const ATLAS_READ_ONLY_TOOLS = ["atlas-list-projects", "atlas-list-orgs", "atlas-list-clusters"];

export interface AtlasApiE2EContext {
    harness: AgentHarness;
    workDir: () => string;
    serverUrl: () => string;
    isHarnessAvailable: () => boolean;
    /** Mock telemetry endpoint the server sends to, when `telemetry` is enabled. */
    telemetryServer: () => MockTelemetryServer | undefined;
    buildOptions: (overrides?: Partial<AgentHarnessOptions>) => AgentHarnessOptions;
}

/**
 * Composes the agent-only `useAgent` hook with an in-process MCP server started
 * with Atlas API credentials and no connection string — no mongod is spun up.
 * With `telemetry`, telemetry goes to a local mock while the Atlas API keeps
 * using the real base URL.
 */
export function useAtlasApiAgent({
    harness,
    telemetry = false,
}: {
    harness: AgentHarness;
    telemetry?: boolean;
}): AtlasApiE2EContext {
    const base = useAgent({ harness });
    let server: InProcessServer | undefined;
    let telemetryServer: MockTelemetryServer | undefined;

    beforeAll(async () => {
        if (!base.isHarnessAvailable() || !hasAtlasApiCreds()) {
            return;
        }
        if (telemetry) {
            telemetryServer = await startMockTelemetryServer();
        }
        server = await startInProcessServer(
            {
                apiClientId: ATLAS_CLIENT_ID,
                apiClientSecret: ATLAS_CLIENT_SECRET,
                apiBaseUrl: ATLAS_BASE_URL,
                ...(telemetryServer ? { telemetry: "enabled", telemetryBaseUrl: telemetryServer.baseUrl } : {}),
            },
            AllTools.filter((tool) => ATLAS_READ_ONLY_TOOLS.includes(tool.toolName))
        );
    }, 120_000);

    afterAll(async () => {
        // Close the server first so its telemetry flushes to the still-running mock.
        await server?.close();
        await telemetryServer?.close();
    });

    return {
        harness,
        workDir: base.workDir,
        serverUrl: () => server?.url ?? "",
        isHarnessAvailable: base.isHarnessAvailable,
        telemetryServer: () => telemetryServer,
        // In-process server first, then agent-only defaults; test overrides win.
        buildOptions: (overrides = {}) => ({
            serverUrl: server?.url,
            mcpServerName: "mongo",
            ...base.buildOptions(),
            ...overrides,
        }),
    } satisfies AtlasApiE2EContext;
}
