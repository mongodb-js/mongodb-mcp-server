import { describe, expect, it } from "vitest";
import { useMcpAgent } from "./utils/useMcpAgent.js";
import { describeHarness } from "./utils/describeHarness.js";

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

                expect(turn.text).toContain(seedDb);
                expect(turn.toolCalls.some((tc) => tc.name === "list-databases")).toBe(true);
            } finally {
                await session.dispose();
            }
        });
    });
});
