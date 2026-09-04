import { describe, expect, it } from "vitest";
import type { AgentTurn } from "@mongodb-js/harness-tester";
import { useMcpAgent } from "./utils/useMcpAgent.js";
import { describeHarness } from "./utils/describeHarness.js";

/**
 * Elicitation end-to-end: the server requires confirmation before
 * confirmation-required tools run (`confirmationRequiredTools` includes
 * `drop-database`). We drive the agent to call it and answer the confirmation.
 */
describe("elicitation", () => {
    describeHarness(({ harness }) => {
        const { mongoClient, dbName, buildOptions } = useMcpAgent({ harness });

        async function dropDatabase(targetDb: string, choice: "confirm" | "decline"): Promise<AgentTurn> {
            await mongoClient().db(targetDb).collection("c").insertOne({ seeded: true });
            const session = await harness.start(buildOptions());
            try {
                const turn = await session.prompt(`Use the "drop-database" tool to drop the database "${targetDb}".`);
                // Send the literal option label the confirmation form showed.
                const label =
                    harness.name === "codex-tui"
                        ? choice === "decline"
                            ? "No, I do not confirm"
                            : "Yes, I confirm"
                        : choice === "decline"
                          ? "Decline"
                          : "Accept";
                await session.chooseOption(label);
                return turn;
            } finally {
                await session.dispose();
            }
        }

        it("elicits confirmation for a confirmation-required tool", async () => {
            const turn = await dropDatabase(`elicitation_${dbName}`, "decline");

            expect(turn.state).toBe("elicitation");
            expect(turn.confirmation?.toLowerCase()).toContain("confirm");
        });

        it("runs the tool when the elicitation is confirmed", async () => {
            const targetDb = `elicitation_accept_${dbName}`;
            const turn = await dropDatabase(targetDb, "confirm");

            expect(turn.state).toBe("elicitation");
            expect(turn.confirmation?.toLowerCase()).toContain("confirm");

            // Confirming executes the tool: the database is dropped.
            const dbs = await mongoClient().db(targetDb).listCollections().toArray();
            expect(dbs.length).toBe(0);
        });
    });
});
