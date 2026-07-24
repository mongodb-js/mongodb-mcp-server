import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "../../src/server.js";
import type { Session } from "../../src/common/session.js";
import { connectionErrorHandler } from "../../src/common/connectionErrorHandler.js";
import { LogId, type LoggerBase } from "../../src/common/logging/index.js";
import type { Telemetry } from "../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../src/elicitation.js";
import { defaultTestConfig } from "../integration/helpers.js";
import { MockMetrics } from "./mocks/metrics.js";

function createServerWithSubscription({
    isConnected = true,
    sendResourceUpdated = vi.fn().mockResolvedValue(undefined),
}: {
    isConnected?: boolean;
    sendResourceUpdated?: ReturnType<typeof vi.fn>;
} = {}): {
    server: Server;
    sendResourceUpdated: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
} {
    const warning = vi.fn();
    const logger = {
        info: vi.fn(),
        debug: vi.fn(),
        warning,
        error: vi.fn(),
    } as unknown as LoggerBase;
    const mcpServer = {
        isConnected: vi.fn().mockReturnValue(isConnected),
        server: { sendResourceUpdated },
    } as unknown as McpServer;
    const server = new Server({
        session: { logger } as unknown as Session,
        userConfig: defaultTestConfig,
        mcpServer,
        telemetry: {
            close: vi.fn(),
            emitEvents: vi.fn(),
        } as unknown as Telemetry,
        elicitation: {} as unknown as Elicitation,
        connectionErrorHandler,
        metrics: new MockMetrics(),
    });

    (server as unknown as { subscriptions: Set<string> }).subscriptions.add("debug://mongodb");

    return { server, sendResourceUpdated, warning };
}

describe("Server resource updates", () => {
    it("does not send resource update notifications after the MCP server disconnects", () => {
        const { server, sendResourceUpdated } = createServerWithSubscription({ isConnected: false });

        server.sendResourceUpdated("debug://mongodb");

        expect(sendResourceUpdated).not.toHaveBeenCalled();
    });

    it("logs resource update notification failures instead of leaving rejections unhandled", async () => {
        const sendResourceUpdated = vi.fn().mockRejectedValue(new Error("Not connected"));
        const { server, warning } = createServerWithSubscription({ sendResourceUpdated });

        server.sendResourceUpdated("debug://mongodb");
        await Promise.resolve();

        expect(sendResourceUpdated).toHaveBeenCalledWith({ uri: "debug://mongodb" });
        expect(warning).toHaveBeenCalledWith({
            id: LogId.resourceUpdateFailure,
            context: "resources",
            message: "Could not send resource update to client: Not connected",
        });
    });
});
