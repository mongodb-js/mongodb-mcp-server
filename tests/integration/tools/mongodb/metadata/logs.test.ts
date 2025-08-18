import { expect, it } from "vitest";
import { validateToolMetadata, validateThrowsForInvalidArguments, getResponseElements } from "../../../helpers.js";
import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

describeWithMongoDB("logs tool", (integration) => {
    validateToolMetadata(integration, "mongodb-logs", "Returns the most recent logged mongod events", [
        {
            type: "string",
            name: "type",
            description:
                "The type of logs to return. Global returns all recent log entries, while startupWarnings returns only warnings and errors from when the process started.",
            required: false,
        },
        {
            type: "integer",
            name: "limit",
            description: "The maximum number of log entries to return.",
            required: false,
        },
    ]);

    validateThrowsForInvalidArguments(integration, "mongodb-logs", [
        { type: 123 },
        { type: "something" },
        { limit: 0 },
        { limit: true },
        { limit: 1025 },
    ]);

    it("should return global logs", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "mongodb-logs",
            arguments: {},
        });

        const elements = getResponseElements(response);

        // Default limit is 50
        expect(elements.length).toBeLessThanOrEqual(51);
        expect(elements[0]?.text).toMatch(/Found: \d+ messages/);

        for (let i = 1; i < elements.length; i++) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const log = JSON.parse(elements[i]?.text ?? "{}");
            expect(log).toHaveProperty("t");
            expect(log).toHaveProperty("msg");
        }
    });

    it("should return startupWarnings logs", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "mongodb-logs",
            arguments: {
                type: "startupWarnings",
            },
        });

        const elements = getResponseElements(response);
        expect(elements.length).toBeLessThanOrEqual(51);
        for (let i = 1; i < elements.length; i++) {
            const log = JSON.parse(elements[i]?.text ?? "{}") as { tags: string[] };
            expect(log).toHaveProperty("t");
            expect(log).toHaveProperty("msg");
            expect(log).toHaveProperty("tags");
            expect(log.tags).toContain("startupWarnings");
        }
    });

    validateAutoConnectBehavior(integration, "mongodb-logs", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "foo",
            },
            validate: (content): void => {
                const elements = getResponseElements(content);
                expect(elements.length).toBeLessThanOrEqual(51);
                expect(elements[0]?.text).toMatch(/Found: \d+ messages/);
            },
        };
    });
});
