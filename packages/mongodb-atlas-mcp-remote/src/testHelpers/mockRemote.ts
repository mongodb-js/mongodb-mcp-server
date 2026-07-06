import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Mock remote MCP server + token endpoint for integration tests.
 */
export class MockRemote {
    readonly url: string;
    private readonly server: Server;

    private responseMode: "sse" | "json" = "sse";
    private tokenRequestCount = 0;
    private currentToken = "";
    private shouldFailNextTokenCall = false;

    private constructor(url: string, server: Server) {
        this.url = url;
        this.server = server;
    }

    static async start(): Promise<MockRemote> {
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const port = (server.address() as AddressInfo).port;
        const instance = new MockRemote(`http://127.0.0.1:${port}`, server);
        server.on("request", (req, res) => void instance.handleRequest(req, res));
        return instance;
    }

    getTokenRequestCount(): number {
        return this.tokenRequestCount;
    }

    setResponseMode(mode: "sse" | "json"): void {
        this.responseMode = mode;
    }

    invalidateToken(): void {
        this.currentToken = "";
    }

    failNextTokenRequest(): void {
        this.shouldFailNextTokenCall = true;
    }

    reset(): void {
        this.responseMode = "sse";
        this.tokenRequestCount = 0;
        this.currentToken = "";
        this.shouldFailNextTokenCall = false;
    }

    close(): Promise<void> {
        return new Promise((resolve) => this.server.close(() => resolve()));
    }

    private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        if (req.url === "/api/oauth/token") {
            this.tokenRequestCount++;
            if (this.shouldFailNextTokenCall) {
                this.shouldFailNextTokenCall = false;
                this.sendJson(res, 401, { error: "unauthorized" });
                return;
            }
            this.currentToken = `token-${this.tokenRequestCount}`;
            this.sendJson(res, 200, { access_token: this.currentToken, expires_in: 3600, token_type: "Bearer" });
            return;
        }

        if (req.url === "/") {
            const body = await this.readBody(req);
            const { id, method, params } = body
                ? (JSON.parse(body) as {
                      id?: string | number | null;
                      method?: string;
                      params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> };
                  })
                : {};

            const auth = req.headers["authorization"];
            if (auth !== `Bearer ${this.currentToken}`) {
                this.sendJson(res, 401, { error: "unauthorized" });
                return;
            }

            // Notifications
            if (id === undefined) {
                res.writeHead(202);
                res.end();
                return;
            }

            if (method === "initialize") {
                res.setHeader("Mcp-Session-Id", "mock-session-1");
                this.sendRpc(res, {
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
                this.sendRpc(res, {
                    jsonrpc: "2.0",
                    id,
                    result: {
                        tools: [
                            {
                                name: "mock-project-tool",
                                description: "Mock tool",
                                inputSchema: {
                                    type: "object",
                                    properties: { projectId: { type: "string" } },
                                    required: ["projectId"],
                                },
                            },
                        ],
                    },
                });
                return;
            }

            if (method === "tools/call") {
                // Only supports mock-project-tool
                if (params?.name !== "mock-project-tool") {
                    this.sendRpc(res, {
                        jsonrpc: "2.0",
                        id,
                        error: { code: -32602, message: `Unknown tool: ${params?.name ?? ""}` },
                    });
                    return;
                }
                if (!params?.arguments?.projectId) {
                    this.sendRpc(res, {
                        jsonrpc: "2.0",
                        id,
                        result: {
                            content: [{ type: "text", text: "Missing required argument: projectId" }],
                            isError: true,
                        },
                    });
                    return;
                }
                this.sendRpc(res, {
                    jsonrpc: "2.0",
                    id,
                    result: {
                        content: [{ type: "text", text: "Mock result for mock-project-tool" }],
                    },
                });
                return;
            }

            this.sendRpc(res, {
                jsonrpc: "2.0",
                id,
                error: { code: -32601, message: `Method not found: ${method ?? ""}` },
            });
            return;
        }

        res.writeHead(404);
        res.end();
    }

    private sendRpc(res: ServerResponse, payload: unknown): void {
        if (this.responseMode === "sse") {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
            res.end();
        } else {
            this.sendJson(res, 200, payload);
        }
    }

    private sendJson(res: ServerResponse, status: number, body: unknown): void {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
    }

    private async readBody(req: IncomingMessage): Promise<string> {
        let body = "";
        for await (const chunk of req) {
            body += chunk;
        }
        return body;
    }
}
