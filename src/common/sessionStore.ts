import type { ClientCapabilities, Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { LoggerBase } from "./logging/index.js";
import { LogId } from "./logging/index.js";
import type { Session } from "./session.js";
import type { ManagedTimeout } from "./managedTimeout.js";
import { setManagedTimeout } from "./managedTimeout.js";
import type { Metrics, DefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { CloseableTransport, SessionCloseReason } from "@mongodb-js/mcp-types";

export type { CloseableTransport, SessionCloseReason };

/**
 * The client state negotiated during MCP initialization. Stores that persist
 * it durably allow an implicitly re-initialized session (one restored on a
 * pod that never saw the client's `initialize` request) to retain the
 * client's capabilities — e.g. whether it supports elicitation — instead of
 * treating the restored client as capability-less.
 */
export type NegotiatedClientState = {
    clientCapabilities?: ClientCapabilities;
    clientInfo?: Implementation;
};

/**
 * Error that `ISessionStore` implementations can throw from `getSession` to
 * reject a request (e.g. when identity validation against the request headers
 * fails). Unlike returning `undefined`, which means the session does not exist
 * and may trigger implicit session initialization, throwing this error fails
 * the request without creating a session. To avoid leaking whether the
 * session exists, the response is indistinguishable from "session not found";
 * the error message is only logged server-side.
 */
export class SessionRejectedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SessionRejectedError";
    }
}

/**
 * Error thrown from `addSession` when the store has already reached its
 * configured `maxSessions` limit. Callers should surface this distinctly
 * from a generic failure so clients can be told to retry later rather than
 * treating it as a permanent request error.
 */
export class SessionLimitExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SessionLimitExceededError";
    }
}

/**
 * Interface for managing MCP transport sessions.
 *
 * Implement this interface to provide custom session storage and lifecycle
 * management (e.g. database-based session storage).
 */
export interface ISessionStore<T extends CloseableTransport = CloseableTransport> {
    /**
     * Returns the transport for the given session id or `undefined` if the
     * session does not exist.
     *
     * @param headers The headers of the incoming request. Implementations can
     * use them to validate the caller's identity before returning the session.
     * To reject a request for an existing session, throw a
     * {@link SessionRejectedError} rather than returning `undefined` — the
     * latter is treated as "session not found" and may trigger implicit
     * session initialization.
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
        logger: LoggerBase;
        session: Session;
        headers?: Record<string, unknown>;
    }): Promise<void>;
    closeSession(params: { sessionId: string; reason?: SessionCloseReason }): Promise<void>;
    closeAllSessions(): Promise<void>;
    /**
     * Durably records the client state negotiated during a real MCP
     * initialization, so it can be restored when the session is later
     * implicitly re-initialized (only relevant with
     * `externallyManagedSessions`). Stores without durable storage can
     * implement this as a no-op (the base `SessionStore` does), in which case
     * restored sessions are treated as capability-less.
     *
     * @param headers The headers of the initiating request, for identity
     * scoping and tracing — mirroring `getSession`.
     */
    saveNegotiatedClientState(
        sessionId: string,
        state: NegotiatedClientState,
        headers?: Record<string, unknown>
    ): Promise<void>;
    /**
     * Returns the previously saved negotiated client state for the session,
     * or `undefined` when unknown. Called during implicit session
     * re-initialization, before the restored session serves its first
     * request.
     */
    loadNegotiatedClientState(
        sessionId: string,
        headers?: Record<string, unknown>
    ): Promise<NegotiatedClientState | undefined>;
}

export class SessionStore<T extends CloseableTransport = CloseableTransport> implements ISessionStore<T> {
    private sessions: {
        [sessionId: string]: {
            logger: LoggerBase;
            transport: T;
            abortTimeout: ManagedTimeout;
            notificationTimeout: ManagedTimeout;
        };
    } = {};

    private readonly idleTimeoutMS: number;
    private readonly notificationTimeoutMS: number;
    private readonly maxSessions: number;
    private readonly logger: LoggerBase;
    private readonly metrics: Metrics<DefaultMetrics>;

    constructor(params: {
        options: { idleTimeoutMS: number; notificationTimeoutMS: number; maxSessions: number };
        logger: LoggerBase;
        metrics: Metrics<DefaultMetrics>;
    }) {
        const { options, logger, metrics } = params;
        this.idleTimeoutMS = options.idleTimeoutMS;
        this.notificationTimeoutMS = options.notificationTimeoutMS;
        this.maxSessions = options.maxSessions;
        this.logger = logger;
        this.metrics = metrics;

        if (this.idleTimeoutMS <= 0) {
            throw new Error("idleTimeoutMS must be greater than 0");
        }
        if (this.notificationTimeoutMS <= 0) {
            throw new Error("notificationTimeoutMS must be greater than 0");
        }
        if (this.idleTimeoutMS <= this.notificationTimeoutMS) {
            throw new Error("idleTimeoutMS must be greater than notificationTimeoutMS");
        }
        if (this.maxSessions < 1) {
            throw new Error("maxSessions must be at least 1");
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async getSession(sessionId: string, _headers?: Record<string, unknown>): Promise<T | undefined> {
        this.resetTimeout(sessionId);
        return Promise.resolve(this.sessions[sessionId]?.transport);
    }

    /**
     * Returns whether a session with the given id exists in this store.
     *
     * Unlike `getSession`, this does not reset the session's idle
     * timeout, so it is safe to call when probing on behalf of requests that
     * may not be served (e.g. authorization checks) without extending the
     * session's lifetime.
     */
    hasSession(sessionId: string): boolean {
        return this.sessions[sessionId] !== undefined;
    }

    private resetTimeout(sessionId: string): void {
        const session = this.sessions[sessionId];
        if (!session) {
            return;
        }

        session.abortTimeout.restart();

        session.notificationTimeout.restart();
    }

    private sendNotification(sessionId: string): void {
        const session = this.sessions[sessionId];
        if (!session) {
            this.logger.warning({
                id: LogId.streamableHttpTransportSessionCloseNotificationFailure,
                context: "sessionStore",
                message: `session ${sessionId} not found, no notification delivered`,
            });
            return;
        }
        session.logger.info({
            id: LogId.streamableHttpTransportSessionCloseNotification,
            context: "sessionStore",
            message: "Session is about to be closed due to inactivity",
        });
    }

    async addSession(params: {
        sessionId: string;
        transport: T;
        /** TODO: Remove in v2 — redundant with `session.logger`. */
        logger: LoggerBase;
        session: Session;
        headers?: Record<string, unknown>;
    }): Promise<void> {
        const { sessionId, transport, logger } = params;
        if (this.sessions[sessionId]) {
            throw new Error(`Session ${sessionId} already exists`);
        }
        if (Object.keys(this.sessions).length >= this.maxSessions) {
            this.logger.warning({
                id: LogId.streamableHttpTransportSessionLimitExceeded,
                context: "sessionStore",
                message: `Refusing to create session ${sessionId}: maxSessions limit of ${this.maxSessions} reached`,
            });
            throw new SessionLimitExceededError(`Session limit of ${this.maxSessions} concurrent sessions reached`);
        }
        const abortTimeout = setManagedTimeout(async () => {
            if (this.sessions[sessionId]) {
                this.sessions[sessionId].logger.info({
                    id: LogId.streamableHttpTransportSessionCloseNotification,
                    context: "sessionStore",
                    message: "Session closed due to inactivity",
                });

                await this.closeSession({ sessionId, reason: "idle_timeout" });
            }
        }, this.idleTimeoutMS);
        const notificationTimeout = setManagedTimeout(
            () => this.sendNotification(sessionId),
            this.notificationTimeoutMS
        );
        this.sessions[sessionId] = {
            transport,
            abortTimeout,
            notificationTimeout,
            logger,
        };
        this.metrics.get("sessionCreated").inc();
        return Promise.resolve();
    }

    async closeSession({
        sessionId,
        reason = "unknown",
    }: {
        sessionId: string;
        reason?: SessionCloseReason;
    }): Promise<void> {
        const session = this.sessions[sessionId];
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        // Remove from map before closing transport so that a re-entrant
        // onsessionclosed callback (fired by transport.close()) sees the
        // session as already gone and doesn't double-count metrics.
        delete this.sessions[sessionId];

        session.abortTimeout.cancel();
        session.notificationTimeout.cancel();

        if (reason !== "transport_closed") {
            // Only close the transport when the server initiates the close.
            try {
                await session.transport.close();
            } catch (error) {
                this.logger.error({
                    id: LogId.streamableHttpTransportSessionCloseFailure,
                    context: "streamableHttpTransport",
                    message: `Error closing transport ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }

        this.metrics.get("sessionClosed").inc({ reason: reason });
    }

    async closeAllSessions(): Promise<void> {
        await Promise.all(
            Object.keys(this.sessions).map((sessionId) => this.closeSession({ sessionId, reason: "server_stop" }))
        );
    }

    /**
     * The in-memory store does not persist negotiated client state: a session
     * it evicts loses its transport too, and restoring client state is only
     * meaningful with durable session storage. Restored sessions therefore
     * behave as capability-less unless a subclass overrides these.
     */
    /* eslint-disable @typescript-eslint/no-unused-vars */
    saveNegotiatedClientState(
        sessionId: string,
        state: NegotiatedClientState,
        headers?: Record<string, unknown>
    ): Promise<void> {
        return Promise.resolve();
    }

    loadNegotiatedClientState(
        sessionId: string,
        headers?: Record<string, unknown>
    ): Promise<NegotiatedClientState | undefined> {
        return Promise.resolve(undefined);
    }
    /* eslint-enable @typescript-eslint/no-unused-vars */
}

/**
 * Constructor arguments for creating a SessionStore instance.
 */
export type SessionStoreConstructorArgs<TMetrics extends DefaultMetrics = DefaultMetrics> = {
    options: { idleTimeoutMS: number; notificationTimeoutMS: number; maxSessions: number };
    logger: LoggerBase;
    metrics: Metrics<TMetrics>;
};

/**
 * A function to create a custom SessionStore instance.
 * When provided, the runner will use this function instead of the default SessionStore constructor.
 */
export type CreateSessionStoreFn<
    TTransport extends CloseableTransport = CloseableTransport,
    TMetrics extends DefaultMetrics = DefaultMetrics,
> = (args: SessionStoreConstructorArgs<TMetrics>) => ISessionStore<TTransport>;

/**
 * Creates a default SessionStore instance from the provided constructor arguments.
 */
export function createDefaultSessionStore<
    TTransport extends CloseableTransport = CloseableTransport,
    TMetrics extends DefaultMetrics = DefaultMetrics,
>(params: SessionStoreConstructorArgs<TMetrics>): SessionStore<TTransport> {
    return new SessionStore(params);
}
