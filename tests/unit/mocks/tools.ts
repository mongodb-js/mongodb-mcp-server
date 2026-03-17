import { z } from "zod";
import { ToolBase } from "../../../src/tools/tool.js";
import type { OperationType, ToolArgs, ToolCategory } from "../../../src/tools/tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TelemetryToolMetadata } from "../../../src/telemetry/types.js";

/** General-purpose tool used by most ToolBase unit tests. */
export class TestTool extends ToolBase {
    static toolName = "test-tool";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "delete";
    public description = "A test tool for verification tests";
    public argsShape = {
        param1: z.string().describe("Test parameter 1"),
        param2: z.number().optional().describe("Test parameter 2"),
    };

    protected execute(): Promise<CallToolResult> {
        return Promise.resolve({
            content: [{ type: "text", text: "Test tool executed successfully" }],
        });
    }

    protected resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        { result }: { result: CallToolResult }
    ): TelemetryToolMetadata {
        if (args.param2 === 3) {
            return { test_param2: "three" } as TelemetryToolMetadata;
        }
        return {};
    }
}

/** Tool that returns structured content, used by appendUIResource tests. */
export class TestToolWithOutputSchema extends ToolBase {
    static toolName = "test-tool-with-output-schema";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "metadata";
    public description = "A test tool with output schema";
    public argsShape = {
        input: z.string().describe("Test input"),
    };
    public override outputSchema = {
        value: z.string(),
        count: z.number(),
    };

    protected execute(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        return Promise.resolve({
            content: [{ type: "text", text: "Tool with output schema executed" }],
            structuredContent: { value: args.input, count: 42 },
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

/** Tool that declares an outputSchema but never returns structuredContent. */
export class TestToolWithoutStructuredContent extends ToolBase {
    static toolName = "test-tool-without-structured";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "metadata";
    public description = "A test tool without structured content";
    public argsShape = {
        input: z.string().describe("Test input"),
    };
    public override outputSchema = {
        value: z.string(),
    };

    protected execute(): Promise<CallToolResult> {
        return Promise.resolve({
            content: [{ type: "text", text: "Tool without structured content executed" }],
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

/** Tool whose execute() always throws – used by error-path tests. */
export class ErrorTool extends ToolBase {
    static toolName = "error-tool";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "read";
    public description = "A tool that always throws";
    public argsShape = {};

    protected execute(): Promise<CallToolResult> {
        return Promise.reject(new Error("intentional error"));
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}
