import { describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { useMcpAgent } from "./useMcpAgent.js";
import { describeHarness } from "./describeHarness.js";

/** The key read tool the happy-path suite already drives end to end. */
const KEY_TOOLS = ["list-databases", "list-collections", "aggregate", "find", "insert-many"];

describe("MCP tool discovery", () => {
    describeHarness(({ harness }) => {
        const { serverUrl, buildOptions } = useMcpAgent({ harness });

        it("exposes the full MongoDB tool set to a direct MCP client", async () => {
            const client = new Client({ name: "e2e-tests", version: "0.0.0" });
            const transport = new StreamableHTTPClientTransport(new URL(serverUrl()));
            await client.connect(transport);
            try {
                const { tools } = await client.listTools();
                const names = tools.map((tool) => tool.name);
                console.log(`[tool-discovery] server exposes ${names.length} tools:\n  ${names.join(", ")}`);

                // Every registration includes a description + input schema; a bare
                // name with no payload would be useless to the agent.
                expect(tools.length).toBeGreaterThan(10);
                for (const tool of tools) {
                    expect(tool.name).toBeTruthy();
                    expect(tool.description).toBeTruthy();
                    expect(tool.inputSchema).toBeDefined();
                }

                // The read path used by the happy-path suite must be present.
                for (const name of KEY_TOOLS) {
                    expect(names).toContain(name);
                }
            } finally {
                await client.close();
            }
        });

        it("lets the agent enumerate the mongo server's tools", async () => {
            const session = await harness.start(buildOptions());
            try {
                const turn = await session.prompt(
                    [
                        `You have access to a MongoDB MCP server named "mongo" through MCP tools. `,
                        `List the names of the tools that server exposes. `,
                        `Use only what you can see in your MCP tool list - do not use any shell commands.`,
                    ].join("")
                );

                // Log the raw output (like the original probe did) so a failing
                // run shows what the agent actually printed.
                console.log(`[tool-discovery] agent reply:\n${turn.transcript ?? turn.text}`);

                expect(turn.text).toBeTruthy();
                // The agent doesn't need to call any tool to answer; it quotes the
                // tool names it sees. Names may render as plain list items outside
                // the parsed reply block, so assert on the raw transcript rather
                // than the best-effort parsed text. Agents write tool names with
                // underscores in prose (model-facing names) even though the server
                // names are hyphenated, so normalize before matching.
                const normalized = (turn.transcript ?? turn.text).toLowerCase().replace(/_/g, "-");
                expect(normalized).toContain("list-databases");
            } finally {
                await session.dispose();
            }
        });
    });
});
