import type { LoggerBase } from "./logging/index.js";
import { LogId } from "./logging/index.js";
import type { ManagedTimeout } from "./managedTimeout.js";
import { setManagedTimeout } from "./managedTimeout.js";
import type { Metrics } from "./metrics/metricsTypes.js";
import type { DefaultMetrics } from "./metrics/metricDefinitions.js";

/**
 * Minimal interface for a transport that can be stored in a SessionStore.
 * The transport must have a close method for cleanup.
 */
export type CloseableTransport = {
    close(): Promise<void>;
};

export type SessionCloseReason = "idle_timeout" | "transport_closed" | "server_stop";

export class SessionStore<T extends CloseableTransport = CloseableTransport> {
    private sessions: {
        [sessionId: string]: {
            logger: LoggerBase;
            transport: T;
            abortTimeout: ManagedTimeout;
            notificationTimeout: ManagedTimeout;
        };
    } = {};

    constructor(
        private readonly idleTimeoutMS: number,
        private readonly notificationTimeoutMS: number,
        private readonly logger: LoggerBase,
        private readonly metrics: Metrics<DefaultMetrics>
    ) {
        if (idleTimeoutMS <= 0) {
            throw new Error("idleTimeoutMS must be greater than 0");
        }
        if (notificationTimeoutMS <= 0) {
            throw new Error("notificationTimeoutMS must be greater than 0");
        }
        if (idleTimeoutMS <= notificationTimeoutMS) {
            throw new Error("idleTimeoutMS must be greater than notificationTimeoutMS");
        }
    }

    getSession(sessionId: string): T | undefined {
        this.resetTimeout(sessionId);
        return this.sessions[sessionId]?.transport;
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

    setSession(sessionId: string, transport: T, logger: LoggerBase): void {
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
    }

    async closeSession({ sessionId, reason }: { sessionId: string; reason: SessionCloseReason }): Promise<void> {
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
            // For "transport_closed" the transport is already torn down by the
            // SDK; calling close() again would double-close and re-trigger
            // onsessionclosed.
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
