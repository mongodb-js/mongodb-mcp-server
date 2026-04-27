import type { LoggerBase } from "./logging/index.js";
import { LogId } from "./logging/index.js";
import type { ManagedTimeout } from "./helpers/managedTimeout.js";
import { setManagedTimeout } from "./helpers/managedTimeout.js";
import type { Metrics, DefaultMetrics } from "@mongodb-js/mcp-metrics";
import type {
    CloseableTransport,
    ISessionStore,
    SessionCloseReason,
    SessionStoreConstructorArgs,
    CreateSessionStoreFn,
} from "@mongodb-js/mcp-api";

export type { CloseableTransport, ISessionStore, SessionCloseReason, CreateSessionStoreFn };

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
    private readonly logger: LoggerBase;
    private readonly metrics: Metrics<DefaultMetrics>;

    constructor(params: {
        options: { idleTimeoutMS: number; notificationTimeoutMS: number };
        logger: LoggerBase;
        metrics: Metrics<DefaultMetrics>;
    }) {
        const { options, logger, metrics } = params;
        this.idleTimeoutMS = options.idleTimeoutMS;
        this.notificationTimeoutMS = options.notificationTimeoutMS;
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
    }

    async getSession(sessionId: string): Promise<T | undefined> {
        this.resetTimeout(sessionId);
        return Promise.resolve(this.sessions[sessionId]?.transport);
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

    async addSession(params: { sessionId: string; transport: T; logger: LoggerBase }): Promise<void> {
        const { sessionId, transport, logger } = params;
        const session = this.sessions[sessionId];
        if (session) {
            throw new Error(`Session ${sessionId} already exists`);
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
}

export type { SessionStoreConstructorArgs };

/**
 * Creates a default SessionStore instance from the provided constructor arguments.
 */
export function createDefaultSessionStore<TTransport extends CloseableTransport = CloseableTransport>(params: {
    options: { idleTimeoutMS: number; notificationTimeoutMS: number };
    logger: LoggerBase;
    metrics: Metrics<DefaultMetrics>;
}): SessionStore<TTransport> {
    return new SessionStore(params);
}
