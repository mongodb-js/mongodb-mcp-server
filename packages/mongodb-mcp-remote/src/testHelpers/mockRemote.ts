import express, { type Express, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * A mock remote MCP server + mock Atlas token endpoint, for integration tests.
 *
 * It pretends to be mcp.mongodb.com (and the Atlas token endpoint) so the wrapper can be
 * tested without a real network and with the same result every run:
 *   - POST /api/oauth/token  → returns a fixed client-credentials token
 *   - POST /mcp              → requires the bearer token, else 401; replies with JSON-RPC
 *
 * The real cloud-dev server replies to /mcp with Server-Sent Events (SSE) and returns an
 * Mcp-Session-Id header on initialize (confirmed in MCP-542). So the mock defaults to SSE
 * and returns a session id; pass `responseMode: "json"` to make it reply with plain JSON
 * instead (the Streamable HTTP spec allows either, so the wrapper should handle both).
 *
 * Kept in one shared file so wrapper.integration.test.ts (and any other test) all use the
 * same mock remote.
 */
export interface MockRemoteOptions {
    responseMode?: "sse" | "json";
}

export interface MockRemote {
    url: string;
    /** How many times the token endpoint was called — lets a test check token reuse/refresh. */
    tokenRequestCount: () => number;
    /** The Authorization header from the most recent /mcp call. */
    lastAuthHeader: () => string | undefined;
    /** Make the next N /mcp calls return 401, so a test can check the refresh-and-retry behavior. */
    failNextMcpCalls: (count: number) => void;
    close: () => Promise<void>;
}

/** Starts a mock remote MCP server + mock Atlas token endpoint on a random free port. */
export async function startMockRemote(options: MockRemoteOptions = {}): Promise<MockRemote> {
    const responseMode = options.responseMode ?? "sse";
    let tokenRequests = 0;
    let lastAuth: string | undefined;
    let mcpFailuresRemaining = 0;

    // Reply to an /mcp request with a JSON-RPC payload, as SSE or plain JSON.
    const sendRpc = (res: Response, payload: unknown): void => {
        if (responseMode === "sse") {
            res.setHeader("Content-Type", "text/event-stream");
            res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
            res.end();
        } else {
            res.json(payload);
        }
    };

    const app: Express = express();
    app.use(express.json());

    // Mock Atlas token endpoint
    app.post("/api/oauth/token", (_req, res) => {
        tokenRequests++;
        res.json({ access_token: "mock-token-123", expires_in: 3600, token_type: "Bearer" });
    });

    // Mock remote MCP endpoint: requires the bearer token, else 401
    app.post("/mcp", (req, res) => {
        lastAuth = req.headers["authorization"];

        const { id, method, params } = (req.body ?? {}) as {
            id?: string | number | null;
            method?: string;
            params?: { protocolVersion?: string };
        };

        // Don't apply the forced 401 to the initialize call or to notifications
        const isHandshakeOrNotification = method === "initialize" || id === undefined || id === null;

        if (!isHandshakeOrNotification && mcpFailuresRemaining > 0) {
            mcpFailuresRemaining--;
            res.status(401).json({ error: "unauthorized" });
            return;
        }
        if (lastAuth !== "Bearer mock-token-123") {
            res.status(401).json({ error: "unauthorized" });
            return;
        }

        // Notifications (e.g. notifications/initialized) have no id
        if (id === undefined || id === null) {
            res.status(202).end();
            return;
        }

        // Return a session id on the first (initialize) call
        res.setHeader("Mcp-Session-Id", "mock-session-1");

        if (method === "initialize") {
            sendRpc(res, {
                jsonrpc: "2.0",
                id,
                result: {
                    protocolVersion: params?.protocolVersion ?? "2024-11-05",
                    capabilities: { tools: {} },
                    serverInfo: { name: "mock-remote-mcp", version: "0.0.0" },
                },
            });
            return;
        }

        if (method === "tools/list") {
            sendRpc(res, {
                jsonrpc: "2.0",
                id,
                result: {
                    tools: [
                        {
                            name: "find",
                            description: "Mock find tool",
                            inputSchema: { type: "object" },
                        },
                    ],
                },
            });
            return;
        }

        // Default: return a minimal valid JSON-RPC result.
        sendRpc(res, { jsonrpc: "2.0", id, result: {} });
    });

    const server: Server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s)); // port 0 → OS picks a free port
    });
    const port = (server.address() as AddressInfo).port;

    return {
        url: `http://127.0.0.1:${port}`,
        tokenRequestCount: () => tokenRequests,
        lastAuthHeader: () => lastAuth,
        failNextMcpCalls: (count: number): void => {
            mcpFailuresRemaining = count;
        },
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
