import type { ILoggerBase } from "./logging.js";
import type { IMetrics, MetricDefinitions } from "./metrics.js";
import type { ISession } from "./session.js";

export type CloseableTransport = {
    close(): Promise<void>;
};

export type SessionCloseReason = "idle_timeout" | "transport_closed" | "server_stop" | "unknown";

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
        /** TODO: Remove in v2 — redundant with `session.logger`. */
        logger: ILoggerBase;
        session: ISession;
        headers?: Record<string, unknown>;
    }): Promise<void>;
    closeSession(params: { sessionId: string; reason?: SessionCloseReason }): Promise<void>;
    closeAllSessions(): Promise<void>;
}

export type SessionStoreConstructorArgs<TMetrics extends MetricDefinitions = MetricDefinitions> = {
    options: { idleTimeoutMS: number; notificationTimeoutMS: number; maxSessions: number };
    logger: ILoggerBase;
    metrics: IMetrics<TMetrics>;
};

export type CreateSessionStoreFn<
    TTransport extends CloseableTransport = CloseableTransport,
    TMetrics extends MetricDefinitions = MetricDefinitions,
> = (args: SessionStoreConstructorArgs<TMetrics>) => ISessionStore<TTransport>;
