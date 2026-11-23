import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { onTestFinished } from "vitest";

import type { BinaryServer } from "./useBinaryServer.js";

export const DEFAULT_CLIENT_NAME = "mcp-integration-test-client";
export const DEFAULT_CLIENT_VERSION = "1.0.0";

export type ConnectClientOptions = {
    /** Client name reported during MCP initialization. */
    clientName?: string;
    /** Client version reported during MCP initialization. */
    clientVersion?: string;
};

/** Connects an AI SDK MCP client to a `BinaryServer`; the client is closed when the test finishes. */
export async function connectClient(server: BinaryServer, options: ConnectClientOptions = {}): Promise<MCPClient> {
    // Close stdin first so the server can flush telemetry before exiting on Windows.
    const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: server.env,
    });
    const client = await createMCPClient({
        transport,
        clientName: options.clientName ?? DEFAULT_CLIENT_NAME,
        version: options.clientVersion ?? DEFAULT_CLIENT_VERSION,
    });
    onTestFinished(() => client.close().catch(() => undefined));
    return client;
}
