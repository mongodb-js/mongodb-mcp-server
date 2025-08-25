import express from "express";
import type http from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { TransportRunnerBase } from "./base.js";
import type { DriverOptions, UserConfig } from "../common/config.js";
import { LogId } from "../common/logger.js";
import { randomUUID } from "crypto";
import { SessionStore } from "../common/sessionStore.js";

const JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED = -32000;
const JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED = -32001;
const JSON_RPC_ERROR_CODE_SESSION_ID_INVALID = -32002;
const JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND = -32003;
const JSON_RPC_ERROR_CODE_INVALID_REQUEST = -32004;

export class StreamableHttpRunner extends TransportRunnerBase {
    private httpServer: http.Server | undefined;
    private sessionStore!: SessionStore;

    constructor(userConfig: UserConfig, driverOptions: DriverOptions) {
        super(userConfig, driverOptions);
    }

    async start(): Promise<void> {
        const app = express();
        this.sessionStore = new SessionStore(
            this.userConfig.idleTimeoutMs,
            this.userConfig.notificationTimeoutMs,
            this.logger
        );

        app.enable("trust proxy"); // needed for reverse proxy support
        app.use(express.json());

        const handleSessionRequest = async (req: express.Request, res: express.Response): Promise<void> => {
            const sessionId = req.headers["mcp-session-id"];
            if (!sessionId) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
                        message: `session id is required`,
                    },
                });
                return;
            }
            if (typeof sessionId !== "string") {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
                        message: `session id is invalid`,
                    },
                });
                return;
            }
            const transport = this.sessionStore.getSession(sessionId);
            if (!transport) {
                res.status(404).json({
                    jsonrpc: "2.0",
                    error: {
                        code: JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
                        message: `session not found`,
                    },
                });
                return;
            }
            await transport.handleRequest(req, res, req.body);
        };

        app.post(
            "/mcp",
            this.withErrorHandling(async (req: express.Request, res: express.Response) => {
                const sessionId = req.headers["mcp-session-id"];
                if (sessionId) {
                    await handleSessionRequest(req, res);
                    return;
                }

                if (!isInitializeRequest(req.body)) {
                    res.status(400).json({
                        jsonrpc: "2.0",
                        error: {
                            code: JSON_RPC_ERROR_CODE_INVALID_REQUEST,
                            message: `invalid request`,
                        },
                    });
                    return;
                }

                const server = this.setupServer();
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: (): string => randomUUID().toString(),
                    onsessioninitialized: (sessionId): void => {
                        server.session.logger.setAttribute("sessionId", sessionId);

                        this.sessionStore.setSession(sessionId, transport, server.session.logger);
                    },
                    onsessionclosed: async (sessionId): Promise<void> => {
                        try {
                            await this.sessionStore.closeSession(sessionId, false);
                        } catch (error) {
                            this.logger.error({
                                id: LogId.streamableHttpTransportSessionCloseFailure,
                                context: "streamableHttpTransport",
                                message: `Error closing session: ${error instanceof Error ? error.message : String(error)}`,
                            });
                        }
                    },
                });

                transport.onclose = (): void => {
                    server.close().catch((error) => {
                        this.logger.error({
                            id: LogId.streamableHttpTransportCloseFailure,
                            context: "streamableHttpTransport",
                            message: `Error closing server: ${error instanceof Error ? error.message : String(error)}`,
                        });
                    });
                };

                await server.connect(transport);

                await transport.handleRequest(req, res, req.body);
            })
        );

        app.get("/mcp", this.withErrorHandling(handleSessionRequest));
        app.delete("/mcp", this.withErrorHandling(handleSessionRequest));

        this.httpServer = await new Promise<http.Server>((resolve, reject) => {
            const result = app.listen(this.userConfig.httpPort, this.userConfig.httpHost, (err?: Error) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(result);
            });
        });

        this.logger.info({
            id: LogId.streamableHttpTransportStarted,
            context: "streamableHttpTransport",
            message: `Server started on http://${this.userConfig.httpHost}:${this.userConfig.httpPort}`,
            noRedaction: true,
        });
    }

    async closeTransport(): Promise<void> {
        await Promise.all([
            this.sessionStore.closeAllSessions(),
            new Promise<void>((resolve, reject) => {
                this.httpServer?.close((err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            }),
        ]);
    }

    private withErrorHandling(
        fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>
    ) {
        return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
            fn(req, res, next).catch((error) => {
                this.logger.error({
                    id: LogId.streamableHttpTransportRequestFailure,
                    context: "streamableHttpTransport",
                    message: `Error handling request: ${error instanceof Error ? error.message : String(error)}`,
                });
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
                        message: `failed to handle request`,
                        data: error instanceof Error ? error.message : String(error),
                    },
                });
            });
        };
    }
}
