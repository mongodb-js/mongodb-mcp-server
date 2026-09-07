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
import {
    LogId,
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    getRandomUUID,
    requestIdAttr,
} from "@mongodb-js/mcp-core";

/** Codes for 2025-era session operations (the branch removed the shared constants). */
const JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND = -32007;

/**
 * The per-request server contract the sessionful legacy path relies on in
 * addition to {@link BaseServer}: it must be connectable to a transport so a
 * session can hold a live server/transport pair — the return channel the
 * SDK's legacy elicitation shim needs.
 */
type SessionfulServer = BaseServer & {
    connect(transport: NodeStreamableHTTPServerTransport): Promise<void>;
    close(): Promise<void>;
};

/** A live 2025-era session: the transport the client talks over plus the connected server. */
interface LegacySession {
    transport: NodeStreamableHTTPServerTransport;
    server: SessionfulServer;
}

/** Builds a fresh request-scoped server for a legacy request. */
export type LegacyServerFactory = (request: TransportRequestContext) => Promise<BaseServer>;

export type LegacyMcpHttpHandlerOptions = {
    /** Builds a fresh request-scoped server for each legacy session. */
    createServer: LegacyServerFactory;
    logger: ILogger;
    http: HttpServerOptions;
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
 * DELETE closes it. Keeping it isolated from {@link MCPHttpServer} leaves the
 * modern stateless path clean.
 */
export class LegacyMcpHttpHandler implements LegacyMcpHandler {
    private readonly createServer: LegacyServerFactory;
    private readonly logger: ILogger;
    private readonly http: HttpServerOptions;
    /** Live sessions keyed by `mcp-session-id`. */
    private readonly sessions = new Map<string, LegacySession>();

    constructor({ createServer, logger, http }: LegacyMcpHttpHandlerOptions) {
        this.createServer = createServer;
        this.logger = logger;
        this.http = http;
    }

    /** Closes every live session (e.g. on server shutdown). */
    public async close(): Promise<void> {
        await Promise.allSettled([...this.sessions.values()].map((s) => s.server.close()));
        this.sessions.clear();
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

    /**
     * Creates a fresh session: builds a request-scoped server, connects it to a
     * sessionful streamable HTTP transport (so `initialize` negotiates and the
     * SDK keeps the client's capabilities on the connected server), and stores
     * the pair so later requests and the SSE idle stream reuse the same
     * transport — the return channel the legacy elicitation shim needs.
     */
    private async createSession(req: express.Request): Promise<LegacySession> {
        const sessionId = getRandomUUID();
        const transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: (): string => sessionId,
            enableJsonResponse: this.http.responseType === "json",
        });
        const server = (await this.createServer(this.buildTransportContext(req))) as unknown as SessionfulServer;
        await server.connect(transport);
        const session: LegacySession = { transport, server };
        this.sessions.set(sessionId, session);

        transport.onclose = (): void => {
            this.sessions.delete(sessionId);
            server.close().catch((error: unknown) => {
                this.logger.error({
                    id: LogId.streamableHttpTransportCloseFailure,
                    context: "streamableHttpTransport",
                    message: `Error closing legacy session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                });
            });
        };

        return session;
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
            // The SSE idle stream for a session (server→client requests).
            const session = this.getSession(req, res, sessionId);
            if (!session) {
                return;
            }
            await session.transport.handleRequest(req, res);
            return;
        }

        if (req.method === "DELETE") {
            // Close the session.
            const session = this.getSession(req, res, sessionId);
            if (!session) {
                return;
            }
            await session.transport.handleRequest(req, res);
            return;
        }

        // POST /mcp.
        if (isInitializeRequest(req.body) && typeof sessionId !== "string") {
            const session = await this.createSession(req);
            await session.transport.handleRequest(req, res, req.body);
            return;
        }

        const session = this.getSession(req, res, sessionId);
        if (!session) {
            return;
        }
        await session.transport.handleRequest(req, res, req.body);
    }

    /** Looks up a live session; reports a session error when missing. */
    private getSession(
        req: express.Request,
        res: express.Response,
        sessionId: string | string[] | undefined
    ): LegacySession | undefined {
        if (typeof sessionId !== "string" || sessionId.length === 0) {
            this.logger.warning({
                id: LogId.streamableHttpTransportRequestFailure,
                context: "streamableHttpTransport",
                message: "Legacy session request missing a session id",
                attributes: { ...requestIdAttr(req.headers) },
            });
            res.status(400).json({
                jsonrpc: "2.0",
                error: {
                    code: JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
                    message: "Session ID is required.",
                },
                id: null,
            });
            return undefined;
        }
        const session = this.sessions.get(sessionId);
        if (!session) {
            this.logger.debug({
                id: LogId.streamableHttpTransportRequestFailure,
                context: "streamableHttpTransport",
                message: `Legacy session ${sessionId} not found`,
                attributes: { ...requestIdAttr(req.headers) },
            });
            res.status(404).json({
                jsonrpc: "2.0",
                error: {
                    code: JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
                    message: "Session not found.",
                },
                id: null,
            });
            return undefined;
        }
        return session;
    }
}
