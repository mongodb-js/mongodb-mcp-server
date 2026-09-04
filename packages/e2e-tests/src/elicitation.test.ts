import { beforeEach, describe, expect, it } from "vitest";
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
        const { mongoClient, buildOptions } = useMcpAgent({ harness });

        const targetDb = `test_elicitation_db`;
        beforeEach(async () => {
            await mongoClient().db(targetDb).collection("c").insertOne({ seeded: true });
        });

        async function dropDatabase(choice: "confirm" | "decline"): Promise<AgentTurn> {
            const session = await harness.start(buildOptions({ promptTimeoutMs: 30_000 }));
            try {
                const turn = await session.prompt(
                    `Use "drop-database" tool to drop the "${targetDb}" database. Do not ask questions or run any other tools, just do it.`
                );
                await session.chooseOption(choice);
                return turn;
            } finally {
                await session.dispose();
            }
        }

        it("elicits confirmation for a confirmation-required tool", { timeout: 60_000 }, async () => {
            const turn = await dropDatabase("decline");

            expect(turn.state).toBe("elicitation");
            expect(turn.confirmation?.toLowerCase()).toContain("confirm");
        });

        it("runs the tool when the elicitation is confirmed", { timeout: 60_000 }, async () => {
            const turn = await dropDatabase("confirm");

            expect(turn.state).toBe("elicitation");
            expect(turn.confirmation?.toLowerCase()).toContain("confirm");

            // Confirming executes the tool: the database is dropped.
            const dbs = await mongoClient().db(targetDb).listCollections().toArray();
            expect(dbs.length).toBe(0);
        });
    });
});
