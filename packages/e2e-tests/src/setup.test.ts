import { describe, expect, it } from "vitest";
import { useMcpAgent } from "./useMcpAgent.js";
import { describeHarness } from "./describeHarness.js";

describe("server setup", () => {
    describeHarness(({ harness }) => {
        const { mongoClient, dbName, buildOptions } = useMcpAgent({ harness });

        it("boots the server as an MCP client and lists databases", async () => {
            // Seed a database so the agent has something deterministic to report.
            const seedDb = `agent_setup_seed_${dbName}`;
            await mongoClient().db(seedDb).collection("c").insertOne({ seeded: true });

            const session = await harness.start(buildOptions());
            try {
                const turn = await session.prompt(
                    [
                        `You have access to a MongoDB MCP server. `,
                        `Use the "list-databases" tool to list the databases. `,
                        `Then reply with the exact list of database names you see. `,
                        `Do not use any shell commands - use only the provided MCP tools.`,
                    ].join("")
                );

                expect(turn.text).toBeTruthy();
                expect(turn.text).toContain(seedDb);
                // The tool call should be recorded; the text assertion above still
                // validates the round-trip if the parser missed it.
                expect(turn.toolCalls.some((tc) => tc.name === "list-databases")).toBe(true);
            } finally {
                await session.dispose();
            }
        });
    });
});
