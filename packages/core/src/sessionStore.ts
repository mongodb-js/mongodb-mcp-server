import type {
    ILogger,
    ICompositeLogger,
    IMetrics,
    CloseableTransport,
    SessionCloseReason,
    DefaultMetricDefinitions,
    ISessionStore,
    SessionStoreConstructorArgs,
} from "@mongodb-js/mcp-types";
import { LogId } from "./logId.js";
import { setManagedTimeout, type ManagedTimeout } from "./managedTimeout.js";

export type { ISessionStore, SessionStoreConstructorArgs };

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
 * Default in-memory session store implementation.
 */
export class SessionStore<T extends CloseableTransport = CloseableTransport> implements ISessionStore<T> {
    private sessions: {
        [sessionId: string]: {
            logger: ILogger;
            transport: T;
            abortTimeout: ManagedTimeout;
            notificationTimeout: ManagedTimeout;
        };
    } = {};

    private readonly idleTimeoutMS: number;
    private readonly notificationTimeoutMS: number;
    private readonly maxSessions: number;
    private readonly logger: ILogger;
    private readonly metrics: IMetrics<DefaultMetricDefinitions>;

    constructor(params: SessionStoreConstructorArgs<DefaultMetricDefinitions>) {
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
                id: LogId.sessionCloseNotificationFailure,
                context: "sessionStore",
                message: `session ${sessionId} not found, no notification delivered`,
            });
            return;
        }
        session.logger.info({
            id: LogId.sessionCloseNotification,
            context: "sessionStore",
            message: "Session is about to be closed due to inactivity",
        });
    }

    async addSession(params: {
        sessionId: string;
        transport: T;
        logger: ILogger;
        session?: { logger: ICompositeLogger };
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
                    id: LogId.sessionCloseNotification,
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
        // Track session created metric
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
                    id: LogId.sessionCloseFailure,
                    context: "streamableHttpTransport",
                    message: `Error closing transport ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }

        // Track session closed metric
        this.metrics.get("sessionClosed").inc({ reason });
    }

    async closeAllSessions(): Promise<void> {
        await Promise.all(
            Object.keys(this.sessions).map((sessionId) => this.closeSession({ sessionId, reason: "server_stop" }))
        );
    }
}

/**
 * A function to create a custom SessionStore instance.
 * When provided, the runner will use this function instead of the default SessionStore constructor.
 */
export type CreateSessionStoreFn<
    TTransport extends CloseableTransport = CloseableTransport,
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> = (args: SessionStoreConstructorArgs<TMetrics>) => ISessionStore<TTransport>;

/**
 * Creates a default SessionStore instance from the provided constructor arguments.
 */
export function createDefaultSessionStore<
    TTransport extends CloseableTransport = CloseableTransport,
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
>(params: SessionStoreConstructorArgs<TMetrics>): SessionStore<TTransport> {
    return new SessionStore(params);
}
