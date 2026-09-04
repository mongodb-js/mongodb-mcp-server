import { describe, expect, it } from "vitest";
import { useMcpAgent } from "./utils/useMcpAgent.js";
import { describeHarness } from "./utils/describeHarness.js";

/**
 * Elicitation (multi-round-trip confirmation) end-to-end: the server is
 * configured to require confirmation before confirming-required tools run
 * (`confirmationRequiredTools`, default includes `drop-database`). We drive
 * the agent to call such a tool and answer the confirmation it surfaces by
 * choosing the "decline" option, then assert the destructive tool did not run.
 */
describe("elicitation", () => {
    describeHarness(({ harness }) => {
        const { mongoClient, dbName, buildOptions } = useMcpAgent({ harness });

        it("elicits confirmation for a confirmation-required tool and does not run it when declined", async () => {
            const targetDb = `elicitation_${dbName}`;
            // Seed a database so the tool call has something deterministic to act on.
            const seeded = mongoClient().db(targetDb).collection("c").insertOne({ seeded: true });
            await seeded;

            const session = await harness.start(buildOptions());
            const confirmations: string[] = [];
            try {
                const turn = await session.prompt(
                    [
                        `You have access to a MongoDB MCP server named "mongo" through MCP tools. `,
                        `Use the "drop-database" tool to drop the database "${targetDb}". `,
                        `Pass connectionId "preconfigured" since the server is already configured with a connection string. `,
                        `This tool requires confirmation before it runs. When you are asked to confirm, `,
                        `choose to decline / refuse the operation. `,
                        `Afterwards, report what happened. Use only MCP tools - do not use shell commands.`,
                    ].join(""),
                    {
                        onConfirmation: ({ text }) => {
                            confirmations.push(text);
                            return "No";
                        },
                    }
                );

                if (process.env.AGENT_E2E_DEBUG) {
                    console.log(`[elicitation] agent reply:\n${turn.text}`);
                }

                // The agent attempted the confirmation-required tool.
                expect(turn.toolCalls.some((tc) => tc.name === "drop-database")).toBe(true);

                // The server surfaced an elicitation confirmation to the agent.
                expect(confirmations.length).toBe(1);
                expect(confirmations[0]?.toLowerCase()).toContain("confirm");

                // The agent declined, so the destructive tool did not run: the DB lives on.
                const dbs = await mongoClient().db(targetDb).listCollections().toArray();
                expect(dbs.length).toBeGreaterThan(0);
            } finally {
                await session.dispose();
            }
        });
    });
});
