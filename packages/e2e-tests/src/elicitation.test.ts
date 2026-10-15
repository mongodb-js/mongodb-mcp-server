import { beforeEach, describe, expect, it } from "vitest";
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

        async function dropDatabase(choice: "confirm" | "decline"): Promise<void> {
            const session = await harness.start(buildOptions());
            try {
                const turn = await session.prompt(
                    `Use "drop-database" tool to drop the "${targetDb}" database. Do not ask questions or run any other tools, just do it.`
                );
                expect(turn).toMatchObject({ state: "elicitation" });
                expect(turn.confirmation?.toLowerCase()).toContain("confirm");

                const after = await session.chooseOption(choice);
                expect(after).toMatchObject({ state: "completed" });
                expect(after.text).not.toContain("ERROR:");
            } finally {
                await session.dispose();
            }
        }

        it("elicits confirmation for a confirmation-required tool", async () => {
            await dropDatabase("decline");
            expect(await mongoClient().db(targetDb).collection("c").findOne({ seeded: true })).not.toBeNull();
        });

        it("runs the tool when the elicitation is confirmed", async () => {
            await dropDatabase("confirm");

            // Confirming executes the tool: the database is dropped.
            const dbs = await mongoClient().db(targetDb).listCollections().toArray();
            expect(dbs.length).toBe(0);
        });
    });
});
