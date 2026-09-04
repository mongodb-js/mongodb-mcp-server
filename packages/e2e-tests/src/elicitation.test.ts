import { describe, expect, it } from "vitest";
import { CodexTuiHarness } from "@mongodb-js/harness-tester";
import { useMcpAgent } from "./utils/useMcpAgent.js";

/**
 * Elicitation end-to-end against codex: the server requires confirmation before
 * confirmation-required tools run (`confirmationRequiredTools` includes
 * `drop-database`). We drive codex to call it and answer the confirmation.
 */
describe("elicitation", () => {
    const { harness, mongoClient, dbName, buildOptions } = useMcpAgent({ harness: new CodexTuiHarness() });

    async function dropDatabase(targetDb: string, choice: "confirm" | "decline"): Promise<string[]> {
        await mongoClient().db(targetDb).collection("c").insertOne({ seeded: true });
        const confirmations: string[] = [];
        const session = await harness.start(buildOptions());
        try {
            await session.prompt(`Use the "drop-database" tool to drop the database "${targetDb}".`, {
                onConfirmation: ({ text }) => {
                    confirmations.push(text);
                    return choice;
                },
            });
        } finally {
            await session.dispose();
        }
        return confirmations;
    }

    it("elicits confirmation for a confirmation-required tool", async () => {
        const confirmations = await dropDatabase(`elicitation_decline_${dbName}`, "decline");

        expect(confirmations.length).toBeGreaterThan(0);
        expect(confirmations[0]?.toLowerCase()).toContain("confirm");
    });

    it("runs the tool when the elicitation is confirmed", async () => {
        const targetDb = `elicitation_accept_${dbName}`;
        const confirmations = await dropDatabase(targetDb, "confirm");

        expect(confirmations.length).toBeGreaterThan(0);
        expect(confirmations[0]?.toLowerCase()).toContain("confirm");

        // Confirming executes the tool: the database is dropped.
        const dbs = await mongoClient().db(targetDb).listCollections().toArray();
        expect(dbs.length).toBe(0);
    });
});
