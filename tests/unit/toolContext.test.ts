import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolBase, type ToolExecutionContext } from "../../src/tools/tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "../../src/server.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Session } from "../../src/common/session.js";
import { UserConfigSchema } from "../../src/common/config/userConfig.js";
import type { Telemetry } from "../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../src/elicitation.js";
import { connectionErrorHandler } from "../../src/common/connectionErrorHandler.js";
import type { TelemetryToolMetadata } from "../../src/telemetry/types.js";
import type { UserConfig } from "../../src/lib.js";

// Define a custom context type
interface CustomContext {
    userId: string;
    tenantId: string;
}

// Tool that receives context
class ToolWithContext extends ToolBase<UserConfig, CustomContext> {
    static toolName = "tool-with-context";
    static category = "mongodb" as const;
    static operationType = "read" as const;
    static receivesContext = true;

    public description = "A tool that receives context";
    public argsShape = {
        message: z.string().describe("A message"),
    };

    protected async execute(args: { message: string }): Promise<CallToolResult> {
        const context = this.context;

        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        message: args.message,
                        userId: context?.userId,
                        tenantId: context?.tenantId,
                        hasContext: !!context,
                    }),
                },
            ],
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

// Tool that does not receive context
class ToolWithoutContext extends ToolBase {
    static toolName = "tool-without-context";
    static category = "mongodb" as const;
    static operationType = "read" as const;
    // receivesContext is not set (defaults to false)

    public description = "A tool that does not receive context";
    public argsShape = {
        message: z.string().describe("A message"),
    };

    protected async execute(args: { message: string }): Promise<CallToolResult> {
        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        message: args.message,
                        // @ts-expect-error - toolContext is not defined
                        contextIsUndefined: this.toolContext === undefined,
                    }),
                },
            ],
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

describe("Tool Context", () => {
    it("should pass context to tools", async () => {
        const userConfig = UserConfigSchema.parse({});
        const mcpServer = new McpServer({ name: "test", version: "1.0.0" });

        const session = {
            logger: {
                debug: () => {},
                error: () => {},
                info: () => {},
                warning: () => {},
            },
        } as unknown as Session;

        const telemetry = {
            isTelemetryEnabled: () => false,
            emitEvents: () => {},
        } as unknown as Telemetry;

        const elicitation = {
            requestConfirmation: () => Promise.resolve(true),
        } as unknown as Elicitation;

        const customContext: CustomContext = {
            userId: "user-123",
            tenantId: "tenant-456",
        };

        const server = new Server<UserConfig, CustomContext>({
            session,
            userConfig,
            mcpServer,
            telemetry,
            elicitation,
            connectionErrorHandler,
            tools: [ToolWithContext],
            toolContext: customContext,
        });

        server.registerTools();

        const tool = server.tools.find((t) => t.name === "tool-with-context");
        expect(tool).toBeDefined();

        if (!tool) {
            throw new Error("Tool not found");
        }

        const baseContext: ToolExecutionContext = {
            signal: new AbortController().signal,
            requestInfo: {
                headers: {},
            },
        };

        const result = await tool.invoke({ message: "test" }, baseContext);

        expect(result.content).toHaveLength(1);
        expect(result.content[0]!.type).toBe("text");

        const resultData = JSON.parse((result.content[0] as { text: string }).text) as {
            message: string;
            userId: string;
            tenantId: string;
            hasContext: boolean;
        };
        expect(resultData.message).toBe("test");
        expect(resultData.userId).toBe("user-123");
        expect(resultData.tenantId).toBe("tenant-456");
        expect(resultData.hasContext).toBe(true);
    });

    it("should not pass context to tools", async () => {
        const userConfig = UserConfigSchema.parse({});
        const mcpServer = new McpServer({ name: "test", version: "1.0.0" });

        const session = {
            logger: {
                debug: () => {},
                error: () => {},
                info: () => {},
                warning: () => {},
            },
        } as unknown as Session;

        const telemetry = {
            isTelemetryEnabled: () => false,
            emitEvents: () => {},
        } as unknown as Telemetry;

        const elicitation = {
            requestConfirmation: () => Promise.resolve(true),
        } as unknown as Elicitation;

        const customContext: CustomContext = {
            userId: "user-123",
            tenantId: "tenant-456",
        };

        const server = new Server<UserConfig, CustomContext>({
            session,
            userConfig,
            mcpServer,
            telemetry,
            elicitation,
            connectionErrorHandler,
            tools: [ToolWithoutContext],
            toolContext: customContext,
        });

        server.registerTools();

        const tool = server.tools.find((t) => t.name === "tool-without-context");
        expect(tool).toBeDefined();

        if (!tool) {
            throw new Error("Tool not found");
        }

        const baseContext: ToolExecutionContext = {
            signal: new AbortController().signal,
            requestInfo: {
                headers: {},
            },
        };

        const result = await tool.invoke({ message: "test" }, baseContext);

        expect(result.content).toHaveLength(1);
        expect(result.content[0]!.type).toBe("text");

        const resultData = JSON.parse((result.content[0] as { text: string }).text) as {
            message: string;
            contextIsUndefined: boolean;
        };
        expect(resultData.message).toBe("test");
        expect(resultData.contextIsUndefined).toBe(true);
    });
});
