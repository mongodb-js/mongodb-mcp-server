import express from "express";
import type {
    StreamableHTTPServerTransport,
    StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { LoggerBase, RequestContext, MCPServer } from "./types.js";
import type { ISessionStore } from "./sessionStore.js";
import type { Metrics, DefaultMetrics } from "@mongodb-mcp/monitoring";
import { ExpressBasedHttpServer } from "./expressServer.js";
import {
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
} from "./httpErrors.js";

export type MCPHttpServerHttpConfig = {
    httpBodyLimit: number;
    httpHeaders: Record<string, unknown>;
    httpResponseType: "sse" | "json";
    externallyManagedSessions: boolean;
};

/**
 * Factory to create a new MCPServer for an incoming HTTP request.
 * Called once per new MCP session initialization.
 */
export type MCPServerFactory = (context: { request: RequestContext }) => Promise<MCPServer>;

export class MCPHttpServer extends ExpressBasedHttpServer {
    private readonly sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    private readonly httpConfig: MCPHttpServerHttpConfig;
    private readonly metrics: Metrics<DefaultMetrics>;
    private readonly createServerForRequest: MCPServerFactory;

    constructor({
        httpConfig,
        createServerForRequest,
        logger,
        metrics,
        sessionStore,
    }: {
        httpConfig: MCPHttpServerHttpConfig & { httpPort: number; httpHost: string };
        createServerForRequest: MCPServerFactory;
        logger: LoggerBase;
        metrics: Metrics<DefaultMetrics>;
        sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    }) {
        super({
            port: httpConfig.httpPort,
            hostname: httpConfig.httpHost,
            logger,
            logContext: "mcpHttpServer",
        });
        this.createServerForRequest = createServerForRequest;
        this.httpConfig = httpConfig;
        this.metrics = metrics;
        this.sessionStore = sessionStore;
    }

    public override async stop(): Promise<void> {
        await Promise.all([this.sessionStore.closeAllSessions(), super.stop()]);
    }

    private reportSessionError(res: express.Response, errorCode: number): void {
        let message: string;
        let statusCode = 400;

        switch (errorCode) {
            case JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED:
                message = "session id is required";
                break;
            case JSON_RPC_ERROR_CODE_SESSION_ID_INVALID:
                message = "session id is invalid";
                break;
            case JSON_RPC_ERROR_CODE_INVALID_REQUEST:
                message = "invalid request";
                break;
            case JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND:
                message = "session not found";
                statusCode = 404;
                break;
            case JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION:
                message = "cannot provide sessionId when externally managed sessions are disabled";
                break;
            default:
                message = "unknown error";
                statusCode = 500;
        }
        res.status(statusCode).json({
            jsonrpc: "2.0",
            error: {
                code: errorCode,
                message,
            },
        });
    }

    protected override async setupRoutes(): Promise<void> {
        const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

        this.app.use(express.json({ limit: this.httpConfig.httpBodyLimit }));
        this.app.use((req, res, next) => {
            for (const [key, value] of Object.entries(this.httpConfig.httpHeaders)) {
                const header = req.headers[key.toLowerCase()];
                if (!header || header !== value) {
                    res.status(403).json({ error: `Invalid value for header "${key}"` });
                    return;
                }
            }

            next();
        });

        const handleSessionRequest = async (req: express.Request, res: express.Response): Promise<void> => {
            const sessionId = req.headers["mcp-session-id"];
            if (!sessionId) {
                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED);
            }

            if (typeof sessionId !== "string") {
                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_INVALID);
            }

            const transport = this.sessionStore.getSession(sessionId);
            if (!transport) {
                this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND);
                return;
            }

            await transport.handleRequest(req, res, req.body);
        };

        const initializeServer = async (
            req: express.Request,
            res: express.Response,
            { sessionId }: { sessionId?: string } = {}
        ): Promise<void> => {
            const request: RequestContext = {
                headers: req.headers as Record<string, string | string[] | undefined>,
                query: req.query as Record<string, string | string[] | undefined>,
            };
            const server = await this.createServerForRequest({ request });

            const finalSessionId = sessionId ?? crypto.randomUUID();
            const options: StreamableHTTPServerTransportOptions = {
                sessionIdGenerator: (): string => finalSessionId,
                enableJsonResponse: this.httpConfig.httpResponseType === "json",
                onsessionclosed: async (closedSessionId): Promise<void> => {
                    try {
                        await this.sessionStore.closeSession({
                            sessionId: closedSessionId,
                            reason: "transport_closed",
                        });
                    } catch (error) {
                        this.logger.error({
                            id: "sessionCloseError",
                            context: "session",
                            message: `Error closing session: ${error instanceof Error ? error.message : String(error)}`,
                        });
                    }
                },
            };

            const transport = new StreamableHTTPServerTransport(options);

            server.session.logger.setAttribute("sessionId", finalSessionId);
            this.sessionStore.setSession(finalSessionId, transport, server.session.logger);

            transport.onclose = (): void => {
                server.close().catch((error: unknown) => {
                    this.logger.error({
                        id: "transportCloseError",
                        context: "transport",
                        message: `Error closing server: ${error instanceof Error ? error.message : String(error)}`,
                    });
                });
            };

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        };

        this.app.post(
            "/mcp",
            this.withErrorHandling(async (req: express.Request, res: express.Response) => {
                const sessionId = req.headers["mcp-session-id"];
                if (sessionId && typeof sessionId !== "string") {
                    return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_INVALID);
                }

                if (isInitializeRequest(req.body)) {
                    if (sessionId && !this.httpConfig.externallyManagedSessions) {
                        return this.reportSessionError(res, JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION);
                    }

                    return await initializeServer(req, res, { sessionId });
                }

                if (sessionId) {
                    return await handleSessionRequest(req, res);
                }

                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_INVALID_REQUEST);
            })
        );

        this.app.get(
            "/mcp",
            this.withErrorHandling(async (req, res): Promise<void> => {
                if (this.httpConfig.httpResponseType === "sse") {
                    await handleSessionRequest(req, res);
                } else {
                    res.status(405).set("Allow", ["POST", "DELETE"]).send("Method Not Allowed");
                }
            })
        );

        this.app.delete("/mcp", this.withErrorHandling(handleSessionRequest));
    }

    private withErrorHandling(
        fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>
    ) {
        return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
            fn(req, res, next).catch((error) => {
                this.logger.error({
                    id: "requestError",
                    context: "request",
                    message: `Error handling request: ${error instanceof Error ? error.message : String(error)}`,
                });

                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
                        message: "failed to handle request",
                    },
                });
            });
        };
    }
}
