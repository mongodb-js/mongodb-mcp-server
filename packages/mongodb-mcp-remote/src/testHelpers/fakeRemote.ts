import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * A fake remote MCP server + fake Atlas token endpoint, for integration tests.
 *
 * Stands in for mcp.mongodb.com (and the Atlas token endpoint) so the wrapper can be
 * exercised fully offline and deterministically:
 *   - POST /api/oauth/token  → returns a canned client-credentials token
 *   - POST /mcp              → requires the bearer token, else 401; echoes JSON-RPC
 *
 * Shared by wrapper.integration.test.ts (and any harness smoke runs) so there is a
 * single source of truth for the fake remote.
 */
export interface FakeRemote {
    /** Base URL, e.g. http://127.0.0.1:54321 */
    url: string;
    /** How many times the token endpoint was hit (asserts caching / refresh behavior). */
    tokenRequestCount: () => number;
    /** The Authorization header seen on the most recent /mcp call. */
    lastAuthHeader: () => string | undefined;
    /** Force the next N /mcp calls to return 401 (to drive the refresh-and-retry path). */
    failNextMcpCalls: (count: number) => void;
    close: () => Promise<void>;
}

/** Spins up a fake remote MCP server + fake Atlas token endpoint on a random port. */
export async function startFakeRemote(): Promise<FakeRemote> {
    let tokenRequests = 0;
    let lastAuth: string | undefined;
    let mcpFailuresRemaining = 0;

    const app: Express = express();
    app.use(express.json());

    // Fake Atlas token endpoint (client-credentials grant).
    app.post("/api/oauth/token", (_req, res) => {
        tokenRequests++;
        res.json({ access_token: "fake-token-123", expires_in: 3600, token_type: "Bearer" });
    });

    // Fake remote MCP endpoint: requires the bearer token, else 401.
    // Method-aware so it satisfies the MCP SDK client's initialize/tools/list handshake.
    app.post("/mcp", (req, res) => {
        lastAuth = req.headers["authorization"];

        const { id, method, params } = (req.body ?? {}) as {
            id?: string | number | null;
            method?: string;
            params?: { protocolVersion?: string };
        };

        // Only the handshake (initialize) and notifications (no id) are exempt from
        // forced failures, so failNextMcpCalls() deterministically targets real
        // post-handshake requests (e.g. tools/list) regardless of notification timing.
        const isHandshakeOrNotification = method === "initialize" || id === undefined || id === null;

        if (!isHandshakeOrNotification && mcpFailuresRemaining > 0) {
            mcpFailuresRemaining--;
            res.status(401).json({ error: "unauthorized" });
            return;
        }
        if (lastAuth !== "Bearer fake-token-123") {
            res.status(401).json({ error: "unauthorized" });
            return;
        }

        // Notifications (e.g. notifications/initialized) have no id and need no result.
        if (id === undefined || id === null) {
            res.json({ jsonrpc: "2.0", result: {} });
            return;
        }

        // Give the server a stable session id on the first (initialize) call.
        res.setHeader("Mcp-Session-Id", "fake-session-1");

        if (method === "initialize") {
            res.json({
                jsonrpc: "2.0",
                id,
                result: {
                    protocolVersion: params?.protocolVersion ?? "2024-11-05",
                    capabilities: { tools: {} },
                    serverInfo: { name: "fake-remote-mcp", version: "0.0.0" },
                },
            });
            return;
        }

        if (method === "tools/list") {
            res.json({
                jsonrpc: "2.0",
                id,
                result: {
                    tools: [
                        {
                            name: "find",
                            description: "Fake find tool",
                            inputSchema: { type: "object" },
                        },
                    ],
                },
            });
            return;
        }

        // Default: echo a minimal valid JSON-RPC result.
        res.json({ jsonrpc: "2.0", id, result: {} });
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
