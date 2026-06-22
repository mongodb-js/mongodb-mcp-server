import { describe, it, expect, vi } from "vitest";
import { Server } from "../../src/server.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Session } from "../../src/common/session.js";
import { UserConfigSchema } from "../../src/common/config/userConfig.js";
import type { Telemetry } from "../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../src/elicitation.js";
import { connectionErrorHandler } from "../../src/common/connectionErrorHandler.js";
import type { ToolExecutionContext, ToolExecutionAuthorizer } from "../../src/tools/tool.js";
import { EchoTool } from "./mocks/tools.js";
import { MockMetrics } from "./mocks/metrics.js";

function buildServer(authorizeToolExecution?: ToolExecutionAuthorizer): Server {
    const session = {
        logger: { debug() {}, error() {}, info() {}, warning() {} },
    } as unknown as Session;
    return new Server({
        session,
        userConfig: UserConfigSchema.parse({}),
        mcpServer: new McpServer({ name: "test", version: "1.0.0" }),
        telemetry: { isTelemetryEnabled: () => false, emitEvents() {} } as unknown as Telemetry,
        elicitation: { requestConfirmation: () => Promise.resolve(true) } as unknown as Elicitation,
        connectionErrorHandler,
        tools: [EchoTool],
        metrics: new MockMetrics(),
        authorizeToolExecution,
    });
}

const execContext: ToolExecutionContext = { signal: new AbortController().signal, requestInfo: { headers: {} } };

describe("Server authorizeToolExecution threading", () => {
    it("passes the authorizer to tools and blocks denied calls", async () => {
        const server = buildServer(() => ({ allowed: false, reason: "denied by policy" }));
        server.registerTools();
        const tool = server.tools.find((t) => t.name === "echo-tool")!;
        const result = await tool.invoke({}, execContext);
        expect(result.isError).toBe(true);
        expect((result.content[0] as { text: string }).text).toContain("denied by policy");
    });

    it("executes normally when the authorizer allows", async () => {
        const authorizer = vi.fn().mockReturnValue({ allowed: true });
        const server = buildServer(authorizer);
        server.registerTools();
        const tool = server.tools.find((t) => t.name === "echo-tool")!;
        const result = await tool.invoke({}, execContext);
        expect(result.isError).toBeUndefined();
        expect((result.content[0] as { text: string }).text).toBe("ok");
        expect(authorizer).toHaveBeenCalledTimes(1);
    });
});
