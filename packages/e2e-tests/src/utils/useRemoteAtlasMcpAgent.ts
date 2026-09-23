import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    useAgent,
    type AgentHarness,
    type AgentHarnessOptions,
} from "@mongodb-js/harness-tester";

export interface RemoteAtlasContext {
    harness: AgentHarness;
    workDir: () => string;
    isHarnessAvailable: () => boolean;
    buildOptions: (overrides?: Partial<AgentHarnessOptions>) => AgentHarnessOptions;
}

// The suite keys off the AGENT_E2E_ prefix (matching the other harness env vars),
// then maps them onto the mongodb-atlas-mcp-remote wrapper's own MDB_MCP_API_* contract.
export const REMOTE_MCP_CLIENT_ID = process.env.AGENT_E2E_MCP_CLIENT_ID ?? "";
export const REMOTE_MCP_CLIENT_SECRET = process.env.AGENT_E2E_MCP_CLIENT_SECRET ?? "";
export const REMOTE_MCP_BASE_URL = process.env.AGENT_E2E_MCP_BASE_URL ?? "";

/**
 * Skip gate: the remote Atlas MCP suite is opt-in via the Atlas MCP-configuration
 * client credentials (OAuth client-credentials) supplied with the AGENT_E2E_ prefix.
 */
export function hasRemoteAtlasCreds(): boolean {
    return !!REMOTE_MCP_CLIENT_ID && !!REMOTE_MCP_CLIENT_SECRET;
}

/** Path to the built mongodb-atlas-mcp-remote stdio CLI (writes no code, only spawns it). */
const REMOTE_CLI_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "mongodb-atlas-mcp-remote",
    "dist",
    "cli.js"
);

/**
 * Compose the agent-only `useAgent` hook with the mongodb-atlas-mcp-remote
 * stdio wrapper as the MCP server the agent connects to. Unlike `useMcpAgent`
 * (which spins up a local mongod + in-process server), this targets the real
 * remote Atlas MCP server via OAuth client-credentials — no mongod needed.
 */
export function useRemoteAtlasMcpAgent({ harness }: { harness: AgentHarness }): RemoteAtlasContext {
    const base = useAgent({ harness });

    const buildOptions = (overrides: Partial<AgentHarnessOptions> = {}): AgentHarnessOptions => ({
        // The wrapper itself handles the OAuth client-credentials flow, so the
        // agent only needs to spawn it as a stdio server (no pre-seeded `oauth`).
        mcpServerName: "atlas",
        stdioServer: {
            command: process.execPath,
            args: [REMOTE_CLI_PATH],
            env: {
                // AGENT_E2E_MCP_* (suite opt-in) -> wrapper's MDB_MCP_API_* (its own contract).
                MDB_MCP_API_CLIENT_ID: REMOTE_MCP_CLIENT_ID,
                MDB_MCP_API_CLIENT_SECRET: REMOTE_MCP_CLIENT_SECRET,
                ...(REMOTE_MCP_BASE_URL ? { MDB_MCP_API_BASE_URL: REMOTE_MCP_BASE_URL } : {}),
            },
        },
        ...base.buildOptions(),
        ...overrides,
    });

    return {
        harness,
        workDir: base.workDir,
        isHarnessAvailable: base.isHarnessAvailable,
        buildOptions,
    } satisfies RemoteAtlasContext;
}
