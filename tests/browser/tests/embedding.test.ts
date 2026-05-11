import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { UserConfigSchema } from "mongodb-mcp-server/web";
import { BrowserTestRunner } from "../utils/utils.js";

describe("MongoDB MCP Server in Browser", () => {
    let runner: BrowserTestRunner;

    beforeAll(async () => {
        const userConfig = UserConfigSchema.parse({
            telemetry: "disabled",
            readOnly: true,
            loggers: ["stderr"],
        });

        runner = new BrowserTestRunner({ userConfig });
        await runner.start();
    });

    afterAll(async () => {
        await runner?.close();
    });

    it("should successfully create server using TransportRunner pattern", () => {
        // Verify runner is initialized
        expect(runner).toBeDefined();

        const client = runner.getClient();
        expect(client).toBeDefined();
    });

    it("should use proper end-user imports from mongodb-mcp-server package", () => {
        const userConfig = UserConfigSchema.parse({
            readOnly: true,
            telemetry: "disabled",
        });

        expect(userConfig).toBeDefined();
        expect(userConfig.readOnly).toBe(true);
    });
});
