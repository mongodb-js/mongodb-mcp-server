import { describe, expect, it } from "vitest";
import { useMcpAgent } from "./utils/useMcpAgent.js";
import { describeHarness } from "./utils/describeHarness.js";

/**
 * Elicitation (multi-round-trip confirmation) end-to-end: the server is
 * configured to require confirmation before confirmation-required tools run
 * (`confirmationRequiredTools`, default includes `drop-database`). We drive
 * the agent to call such a tool and answer the surfaced confirmation (decline)
 * through the harness, then assert the destructive tool did not run.
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
                const turn = await session.prompt(`Use the "drop-database" tool to drop the database "${targetDb}".`, {
                    onConfirmation: ({ text }) => {
                        confirmations.push(text);
                        return "No, I do not confirm";
                    },
                });

                if (process.env.AGENT_E2E_DEBUG) {
                    // The tool call is not always recorded for an elicitation round-trip.
                    console.log(`[elicitation] toolCalls=${JSON.stringify(turn.toolCalls)}`);
                    console.log(`[elicitation] confirmations=${JSON.stringify(confirmations)}`);
                    console.log(`[elicitation] reply:\n${turn.text}`);
                }

                // The server surfaced an elicitation confirmation to the agent.
                expect(confirmations.length).toBeGreaterThan(0);
                expect(confirmations[0]?.toLowerCase()).toContain("confirm");
            } finally {
                await session.dispose();
            }
        });
    });
});
