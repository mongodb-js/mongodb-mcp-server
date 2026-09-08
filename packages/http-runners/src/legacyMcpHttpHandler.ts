import { isInitializeRequest } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type express from "express";
import type {
    ILogger,
    TransportRequestContext,
    RequestAuthInfo,
    HttpServerOptions,
    BaseServer,
} from "@mongodb-js/mcp-types";
import { LogId, getRandomUUID, requestIdAttr } from "@mongodb-js/mcp-core";
import { SessionLimitExceededError, type ISessionStore } from "@mongodb-js/mcp-core";
import { sleep } from "./utils.js";

/**
 * Session error codes as they were served to 2025-era clients on main; the
 * shared constants were removed from mcp-core with the session surface, so
 * the legacy path keeps its wire contract locally.
 */
const JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED = -32001;
const JSON_RPC_ERROR_CODE_SESSION_ID_INVALID = -32002;
const JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND = -32003;
const JSON_RPC_ERROR_CODE_INVALID_REQUEST = -32004;
const JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION = -32005;
const JSON_RPC_ERROR_CODE_SESSION_LIMIT_EXCEEDED = -32006;

/** The per-request server contract the sessionful legacy path relies on in
 * addition to {@link BaseServer}: it must be connectable to a transport so a
 * session can hold a live server/transport pair — the return channel the
 * SDK's legacy elicitation shim needs. */
type SessionfulServer = BaseServer & {
    connect(transport: NodeStreamableHTTPServerTransport): Promise<void>;
    close(): Promise<void>;
};

/** Builds a fresh request-scoped server for a legacy request. */
export type LegacyServerFactory = (request: TransportRequestContext) => Promise<BaseServer>;

/** Tunables forwarded to the {@link SessionStore}. */
export type LegacySessionOptions = {
    maxSessions?: number;
    idleTimeoutMS?: number;
    notificationTimeoutMS?: number;
    evictionIdleGraceMS?: number;
};

export type LegacyMcpHttpHandlerOptions = {
    /** Builds a fresh request-scoped server for the legacy session. */
    createServer: LegacyServerFactory;
    logger: ILogger;
    http: HttpServerOptions;
    /** Session store backing the legacy sessionful path (auth-aware or durable). */
    sessionStore: ISessionStore<NodeStreamableHTTPServerTransport>;
};

/**
 * The contract {@link MCPHttpServer.createLegacyHandler} returns for 2025-era
 * serving. It is deliberately transport-shaped so alternative implementations
 * (a different transport, a distributed session store, ...) can be returned by
 * overriding `createLegacyHandler`.
 */
export interface LegacyMcpHandler {
    /** Serves one 2025-era HTTP request (POST/GET/DELETE) to `/mcp`. */
    handle(req: express.Request, res: express.Response): Promise<void>;
    /** Releases any held resources (e.g. live sessions) on shutdown. */
    close(): Promise<void>;
}

/**
 * Serves 2025-era (legacy) MCP requests over streamable HTTP **sessionfully**.
 *
 * The 2026-07-28 protocol is stateless and carries client identity per request
 * in the `_meta` envelope. The 2025 protocol is not: it declares the client's
 * negotiated capabilities (incl. `elicitation`) in the `initialize` handshake
 * and delivers elicitation as real server→client requests. Both need a live,
 * correlated transport, which is exactly what the SDK's legacy elicitation
 * shim relies on. The SDK's `legacy: 'stateless'` mode cannot do that (each
 * request gets a fresh instance: no capabilities, no return channel).
 *
 * This handler owns that sessionful lifecycle: an `initialize` POST creates a
 * session (a connected transport/server pair), later requests and the SSE idle
 * stream reuse the session's transport (the shim's return channel), and a
 * DELETE closes it. Sessions are bounded by the injected `sessionStore`.
 * Keeping it isolated from {@link MCPHttpServer} leaves the modern stateless
 * path clean.
 */
export class LegacyMcpHttpHandler implements LegacyMcpHandler {
    private readonly createServer: LegacyServerFactory;
    private readonly logger: ILogger;
    private readonly http: HttpServerOptions;
    private readonly sessions: ISessionStore<NodeStreamableHTTPServerTransport>;

    constructor({ createServer, logger, http, sessionStore }: LegacyMcpHttpHandlerOptions) {
        this.createServer = createServer;
        this.logger = logger;
        this.http = http;
        this.sessions = sessionStore;
    }

    /** Closes every live session (e.g. on server shutdown). */
    public async close(): Promise<void> {
        await this.sessions.closeAllSessions();
    }

    private buildTransportContext(req: express.Request): TransportRequestContext {
        return {
            headers: req.headers,
            query: req.query as Record<string, string | string[] | undefined>,
            // The explicit auth state of this request. Legacy serving does not
            // normalize authInfo itself; hosts supply it via `req.auth` when
            // using authenticated mode.
            authInfo: (req as express.Request & { auth?: RequestAuthInfo }).auth
                ? { mode: "authenticated", state: (req as express.Request & { auth: RequestAuthInfo }).auth }
                : { mode: "unauthenticated" },
        };
    }

    /** Reports a session error the way main did: same codes, messages, and statuses. */
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
            case JSON_RPC_ERROR_CODE_SESSION_LIMIT_EXCEEDED:
                message = "server has reached the maximum number of concurrent sessions, try again later";
                statusCode = 503;
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

    /**
     * Keeps the session's SSE idle stream alive through proxies and reaps dead
     * clients: pings every 30s and closes the transport after 3 consecutive
     * failures. Not started in JSON response mode, where connections are
     * short-lived and pings aren't needed.
     */
    private async startKeepAliveLoop({
        transport,
        signal,
    }: {
        transport: NodeStreamableHTTPServerTransport;
        signal: AbortSignal;
    }): Promise<void> {
        if (this.http.responseType === "json") {
            return;
        }

        let failedPings = 0;

        while (!signal.aborted) {
            try {
                this.logger.debug({
                    id: LogId.streamableHttpTransportKeepAlive,
                    context: "streamableHttpTransport",
                    message: "Sending ping",
                });

                await transport.send({
                    jsonrpc: "2.0",
                    method: "ping",
                });
                failedPings = 0;
            } catch (err) {
                try {
                    failedPings++;
                    this.logger.warning({
                        id: LogId.streamableHttpTransportKeepAliveFailure,
                        context: "streamableHttpTransport",
                        message: `Error sending ping (attempt #${failedPings}): ${err instanceof Error ? err.message : String(err)}`,
                    });

                    if (failedPings > 3) {
                        await transport.close();
                        return;
                    }
                } catch {
                    // Ignore the error of the transport close
                }
            }

            await sleep(30_000, { signal });
        }
    }

    /**
     * Creates a fresh session: builds a request-scoped server, connects it to a
     * sessionful streamable HTTP transport (so `initialize` negotiates and the
     * SDK keeps the client's capabilities on the connected server), and stores
     * the transport so later requests and the SSE idle stream reuse it (the
     * return channel the legacy elicitation shim needs).
     */
    private async createSession(req: express.Request): Promise<NodeStreamableHTTPServerTransport> {
        const sessionId = getRandomUUID();
        const transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: (): string => sessionId,
            enableJsonResponse: this.http.responseType === "json",
        });
        const server = (await this.createServer(this.buildTransportContext(req))) as unknown as SessionfulServer;

        // Admit (check cap, evict LRU idle victim). A rejection admits nothing.
        try {
            await this.sessions.addSession({ sessionId, transport, logger: this.logger, headers: req.headers });
        } catch (error) {
            // Dispose the un-connected server we built for a rejected session.
            await server.close().catch(() => undefined);
            throw error;
        }

        const keepAliveController = new AbortController();
        void this.startKeepAliveLoop({ transport, signal: keepAliveController.signal });
        // When the transport closes (client disconnect or store-initiated
        // eviction/timeout), tear down the server and remove the session.
        transport.onclose = (): void => {
            keepAliveController.abort();
            void server
                .close()
                .catch((error: unknown) => {
                    this.logger.error({
                        id: LogId.streamableHttpTransportCloseFailure,
                        context: "streamableHttpTransport",
                        message: `Error closing legacy session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                    });
                })
                .finally(() => {
                    // The store removes the session before it closes the
                    // transport, so on store-initiated closes (eviction, idle
                    // timeout) the session is already gone — nothing to do.
                    if (!this.sessions.hasSession(sessionId)) {
                        return;
                    }
                    this.sessions.closeSession({ sessionId, reason: "transport_closed" }).catch((error: unknown) => {
                        this.logger.error({
                            id: LogId.streamableHttpTransportCloseFailure,
                            context: "streamableHttpTransport",
                            message: `Error removing legacy session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                        });
                    });
                });
        };

        try {
            await server.connect(transport);
        } catch (error) {
            // Don't leave a never-connected session registered; closing the
            // transport triggers the onclose teardown above.
            await this.sessions.closeSession({ sessionId, reason: "unknown" }).catch(() => undefined);
            await server.close().catch(() => undefined);
            throw error;
        }

        return transport;
    }

    /**
     * Serves a 2025-era request. POSTs that carry no session begin a new session
     * (the `initialize` handshake); POSTs/GETs/DELETEs that carry a session id
     * are routed to the stored transport, preserving the client's negotiated
     * state and providing the SSE return channel for server→client requests.
     */
    public async handle(req: express.Request, res: express.Response): Promise<void> {
        const sessionId = req.headers["mcp-session-id"];

        if (req.method === "GET") {
            // The SSE idle stream only exists in SSE response mode.
            if (this.http.responseType === "json") {
                res.status(405).set("Allow", ["POST", "DELETE"]).send("Method Not Allowed");
                return;
            }
            await this.handleSessionRequest(req, res, sessionId);
            return;
        }

        if (req.method === "DELETE") {
            await this.handleSessionRequest(req, res, sessionId);
            return;
        }

        // POST /mcp.
        if (sessionId && typeof sessionId !== "string") {
            this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_INVALID);
            return;
        }

        if (isInitializeRequest(req.body)) {
            if (sessionId) {
                // This shim has no externally managed sessions; a client-provided
                // session id on initialize is rejected as on main.
                this.logger.debug({
                    id: LogId.streamableHttpTransportDisallowedExternalSessionError,
                    context: "streamableHttpTransport",
                    message: `Client provided session ID ${sessionId} on initialize, but externally managed sessions are not supported`,
                    attributes: { ...requestIdAttr(req.headers) },
                });
                this.reportSessionError(res, JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION);
                return;
            }

            let transport: NodeStreamableHTTPServerTransport;
            try {
                transport = await this.createSession(req);
            } catch (error) {
                if (error instanceof SessionLimitExceededError) {
                    this.logger.warning({
                        id: LogId.streamableHttpTransportRequestFailure,
                        context: "streamableHttpTransport",
                        message: `Rejecting legacy session startup: ${error.message}`,
                        attributes: { ...requestIdAttr(req.headers) },
                    });
                    this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_LIMIT_EXCEEDED);
                    return;
                }
                throw error;
            }
            await transport.handleRequest(req, res, req.body);
            return;
        }

        if (!sessionId) {
            this.reportSessionError(res, JSON_RPC_ERROR_CODE_INVALID_REQUEST);
            return;
        }

        await this.handleSessionRequest(req, res, sessionId);
    }

    /** Routes a session-carrying request to its live transport; reports a session error when missing. */
    private async handleSessionRequest(
        req: express.Request,
        res: express.Response,
        sessionId: string | string[] | undefined
    ): Promise<void> {
        if (!sessionId) {
            this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED);
            return;
        }
        if (typeof sessionId !== "string") {
            this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_INVALID);
            return;
        }
        const transport = await this.sessions.getSession(sessionId, req.headers);
        if (!transport) {
            this.logger.debug({
                id: LogId.streamableHttpTransportSessionNotFound,
                context: "streamableHttpTransport",
                message: `Session with ID ${sessionId} not found`,
                attributes: { ...requestIdAttr(req.headers) },
            });
            this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND);
            return;
        }
        await transport.handleRequest(req, res, req.body);
    }
}
