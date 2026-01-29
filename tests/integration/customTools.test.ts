import { describe, it, expect } from "vitest";
import { ToolBase, type ToolArgs } from "../../src/tools/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { TelemetryToolMetadata } from "../../src/telemetry/types.js";
import { defaultTestConfig, setupIntegrationTest } from "./helpers.js";

describe("Custom Tools", () => {
    const { mcpClient, mcpServer } = setupIntegrationTest(() => ({ ...defaultTestConfig }), {
        serverOptions: {
            tools: [CustomGreetingTool, CustomCalculatorTool],
        },
    });

    it("should register custom tools instead of default tools", async () => {
        // Check that custom tools are registered
        const tools = await mcpClient().listTools();
        const customGreetingTool = tools.tools.find((t) => t.name === "custom_greeting");
        const customCalculatorTool = tools.tools.find((t) => t.name === "custom_calculator");

        expect(customGreetingTool).toBeDefined();
        expect(customCalculatorTool).toBeDefined();

        // Check that default tools are NOT registered since we only provided custom tools
        const defaultTool = tools.tools.find((t) => t.name === "list-databases");
        expect(defaultTool).toBeUndefined();
    });

    it("should execute custom tools", async () => {
        const result = await mcpClient().callTool({
            name: "custom_greeting",
            arguments: { name: "World" },
        });

        expect(result.content).toEqual([
            {
                type: "text",
                text: "Hello, World! This is a custom tool.",
            },
        ]);

        const result2 = await mcpClient().callTool({
            name: "custom_calculator",
            arguments: { a: 5, b: 3 },
        });

        expect(result2.content).toEqual([
            {
                type: "text",
                text: "Result: 8",
            },
        ]);

        const result3 = await mcpClient().callTool({
            name: "custom_calculator",
            arguments: { a: 4, b: 7 },
        });

        expect(result3.content).toEqual([
            {
                type: "text",
                text: "Result: 11",
            },
        ]);
    });

    it("should respect tool categories and operation types from custom tools", () => {
        const customGreetingTool = mcpServer().tools.find((t) => t.name === "custom_greeting");
        expect(customGreetingTool?.category).toBe("mongodb");
        expect(customGreetingTool?.operationType).toBe("read");

        const customCalculatorTool = mcpServer().tools.find((t) => t.name === "custom_calculator");
        expect(customCalculatorTool?.category).toBe("mongodb");
        expect(customCalculatorTool?.operationType).toBe("read");
    });
});

/**
 * Example custom tool that can be provided by library consumers
 */
class CustomGreetingTool extends ToolBase {
    name = "custom_greeting";
    static category = "mongodb" as const;
    static operationType = "read" as const;
    public description = "A custom tool that greets the user";
    public argsShape = {
        name: z.string().describe("The name to greet"),
    };

    public execute({ name }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: `Hello, ${name}! This is a custom tool.`,
                },
            ],
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

/**
 * Another example custom tool that performs a calculation
 */
class CustomCalculatorTool extends ToolBase {
    name = "custom_calculator";
    static category = "mongodb" as const;
    static operationType = "read" as const;
    public description = "A custom tool that performs calculations";
    public argsShape = {
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
    };

    public execute({ a, b }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: `Result: ${a + b}`,
                },
            ],
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}
