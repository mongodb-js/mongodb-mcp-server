import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { BrowserTestRunner } from "../utils/utils.js";

describe("MongoDB MCP Server in Browser", () => {
    let runner: BrowserTestRunner;

    beforeAll(async () => {
        runner = new BrowserTestRunner();
        await runner.start();
    });

    afterAll(async () => {
        await runner?.close();
    });

    it("should successfully create server using TransportRunner pattern", () => {
        // Verify runner is initialized
        expect(runner).toBeDefined();

        const client = runner.client;
        expect(client).toBeDefined();
    });
});
