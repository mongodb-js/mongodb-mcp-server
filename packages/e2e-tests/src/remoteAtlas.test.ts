import { describe, expect, it } from "vitest";
import { useRemoteAtlasMcpAgent, hasRemoteAtlasCreds } from "./utils/useRemoteAtlasMcpAgent.js";
import { describeHarness } from "./utils/describeHarness.js";

/**
 * Remote Atlas MCP e2e: drives the codex + claude TUIs against the real remote
 * Atlas MCP server, through the mongodb-atlas-mcp-remote stdio wrapper (which
 * authenticates with OAuth client-credentials). This exercises the full stack
 * that a user's MCP client hits: TUI -> wrapper (stdio proxy) -> remote Atlas
 * MCP server -> Atlas API.
 *
 * Opt-in: skips unless `AGENT_E2E_MCP_CLIENT_ID`/`AGENT_E2E_MCP_CLIENT_SECRET` are
 * set (mapped onto the wrapper's `MDB_MCP_API_*` creds).
 */
describe.skipIf(!hasRemoteAtlasCreds())("remote Atlas MCP (mongodb-atlas-mcp-remote)", () => {
    describeHarness(({ harness }) => {
        const { buildOptions } = useRemoteAtlasMcpAgent({ harness });

        it("lists Atlas projects through the remote wrapper", { timeout: 180_000 }, async () => {
            const session = await harness.start(buildOptions());
            try {
                const turn = await session.prompt(
                    [
                        `You have access to a remote Atlas MCP server named "atlas" through MCP tools. `,
                        `Call the "atlas-list-projects" tool to list the Atlas projects you can access. `,
                        `Then reply with the number of projects you see. `,
                        `Use only the provided MCP tools - do not use any shell commands.`,
                    ].join("")
                );

                if (process.env.AGENT_E2E_DEBUG) {
                    console.log(`[remote-atlas] agent reply:\n${turn.text}`);
                }

                // The agent actually invoked `atlas-list-projects` through the wrapper.
                expect(turn.toolCalls.some((tc) => tc.name === "atlas-list-projects")).toBe(true);

                // No auth/transport failure leaked into the transcript, and the agent
                // reports a concrete count (or explicitly that there are none) — not just
                // a passing mention of the word "project".
                expect(turn.text).not.toMatch(/\b(error|failed|forbidden|unable|unauthori[sz]\w*|\b403)\b/i);
                expect(turn.text).toMatch(/(\d+)\s+projects?|no projects/i);
            } finally {
                await session.dispose();
            }
        });
    });
});
