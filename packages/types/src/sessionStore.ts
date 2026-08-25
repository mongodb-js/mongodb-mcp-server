import type { ClientCapabilities, Implementation } from "@modelcontextprotocol/server";
import type { ILogger, ICompositeLogger } from "./logging.js";
import type { IMetrics, DefaultMetricDefinitions } from "./metrics.js";

export type CloseableTransport = {
    close(): Promise<void>;
};

export type SessionCloseReason = "idle_timeout" | "transport_closed" | "server_stop" | "unknown" | "evicted";

/**
 * The client state negotiated during MCP initialization. Stores that persist
 * it durably allow an implicitly re-initialized session (one restored on a
 * pod that never saw the client's `initialize` request) to retain the
 * client's capabilities -- e.g. whether it supports elicitation -- instead of
 * treating the restored client as capability-less.
 */
export type NegotiatedClientState = {
    clientCapabilities?: ClientCapabilities;
    clientInfo?: Implementation;
};

export interface ISessionStore<T extends CloseableTransport = CloseableTransport> {
    /**
     * Returns the transport for the given session id or `undefined` if the
     * session does not exist.
     *
     * @param headers The headers of the incoming request. Implementations can
     * use them to validate the caller's identity before returning the session.
     * To reject a request for an existing session, throw a
     * `SessionRejectedError` rather than returning `undefined` — the latter is
     * treated as "session not found" and may trigger implicit session
     * initialization.
     */
    getSession(sessionId: string, headers?: Record<string, unknown>): Promise<T | undefined>;
    /**
     * Stores a newly initialized session.
     *
     * @param params.session The server session, exposing session-level state
     * (e.g. the logger or the connection manager) to implementations that
     * need it.
     * @param params.headers The headers of the request that initiated the
     * session (e.g. for tracing the x-request-id in logs and downstream
     * requests).
     */
    addSession(params: {
        sessionId: string;
        transport: T;
        logger: ILogger;
        session?: { logger: ICompositeLogger };
        headers?: Record<string, unknown>;
    }): Promise<void>;
    closeSession(params: { sessionId: string; reason?: SessionCloseReason }): Promise<void>;
    closeAllSessions(): Promise<void>;
    /**
     * Durably records the client state negotiated during a real MCP
     * initialization, so it can be restored when the session is later
     * implicitly re-initialized (only relevant with
     * `externallyManagedSessions`). Stores without durable storage can
     * implement this as a no-op.
     */
    saveNegotiatedClientState(
        sessionId: string,
        state: NegotiatedClientState,
        headers?: Record<string, unknown>
    ): Promise<void>;
    /**
     * Returns the previously saved negotiated client state for the session,
     * or `undefined` when unknown.
     */
    loadNegotiatedClientState(
        sessionId: string,
        headers?: Record<string, unknown>
    ): Promise<NegotiatedClientState | undefined>;
}

export type SessionStoreConstructorArgs<TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions> = {
    options: {
        idleTimeoutMS: number;
        notificationTimeoutMS: number;
        maxSessions: number;
        /**
         * When the store is at `maxSessions` and a new session arrives, evict the
         * least-recently-used session instead of rejecting -- but only if it has been
         * idle for at least this long (ms). Must be < `idleTimeoutMS` (the background
         * reaper already removes anything past that), or the valve never fires. If a
         * session idle >= this exists, it is closed locally to make room; otherwise
         * the new session is rejected. Defaults to 120_000 (2 min), clamped to
         * `idleTimeoutMS`.
         */
        evictionIdleGraceMS?: number;
    };
    logger: ILogger;
    metrics: IMetrics<TMetrics>;
};
