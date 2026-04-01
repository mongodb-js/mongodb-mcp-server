import type { LoggerBase } from "./types.js";
import type { Metrics, DefaultMetrics } from "@mongodb-mcp/monitoring";

/**
 * Minimal interface for a transport that can be stored in a SessionStore.
 */
export interface CloseableTransport {
    close(): Promise<void>;
}

export type SessionCloseReason = "idle_timeout" | "transport_closed" | "server_stop" | "unknown";

/**
 * Interface for managing MCP transport sessions.
 */
export interface ISessionStore<T extends CloseableTransport = CloseableTransport> {
    getSession(sessionId: string): T | undefined;
    setSession(sessionId: string, transport: T, logger: LoggerBase): void;
    closeSession(params: { sessionId: string; reason?: SessionCloseReason }): Promise<void>;
    closeAllSessions(): Promise<void>;
}

/**
 * Managed timeout interface for session cleanup.
 */
interface ManagedTimeout {
    refresh(): void;
    clear(): void;
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

    constructor(
        private readonly idleTimeoutMs: number,
        private readonly notificationTimeoutMs: number,
        private readonly logger: LoggerBase,
        private readonly metrics: Metrics<DefaultMetrics>
    ) {
        if (idleTimeoutMs <= 0) {
            throw new Error("idleTimeoutMs must be greater than 0");
        }
        if (notificationTimeoutMs <= 0) {
            throw new Error("notificationTimeoutMs must be greater than 0");
        }
    }

    private createManagedTimeout(callback: () => void, delay: number): ManagedTimeout {
        let timeoutId: NodeJS.Timeout | undefined;

        const refresh = (): void => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            timeoutId = setTimeout(callback, delay);
        };

        const clear = (): void => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = undefined;
            }
        };

        // Start the timeout immediately
        refresh();

        return { refresh, clear };
    }

    setSession(sessionId: string, transport: T, logger: LoggerBase): void {
        const abortTimeout = this.createManagedTimeout(async () => {
            this.logger.info({
                id: "idleTimeout",
                context: "session",
                message: `Closing idle session ${sessionId}`,
            });
            await this.closeSession({ sessionId, reason: "idle_timeout" });
        }, this.idleTimeoutMs);

        const notificationTimeout = this.createManagedTimeout(() => {
            logger.warning({
                id: "notificationTimeout",
                context: "session",
                message: `Session ${sessionId} has been idle and will be closed soon`,
            });
        }, this.idleTimeoutMs - this.notificationTimeoutMs);

        this.sessions[sessionId] = {
            logger,
            transport,
            abortTimeout,
            notificationTimeout,
        };

        this.metrics.get("sessionCreated").inc();
    }

    getSession(sessionId: string): T | undefined {
        const session = this.sessions[sessionId];
        if (session) {
            // Refresh timeouts on activity
            session.abortTimeout.refresh();
            session.notificationTimeout.refresh();
        }
        return session?.transport;
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
            return;
        }

        // Clear timeouts
        session.abortTimeout.clear();
        session.notificationTimeout.clear();

        // Close the transport
        try {
            await session.transport.close();
        } catch (error) {
            session.logger.error({
                id: "closeError",
                context: "session",
                message: `Error closing transport: ${error instanceof Error ? error.message : String(error)}`,
            });
        }

        // Remove from sessions
        delete this.sessions[sessionId];

        this.metrics.get("sessionClosed").inc({ reason });
    }

    async closeAllSessions(): Promise<void> {
        await Promise.all(
            Object.keys(this.sessions).map((sessionId) => this.closeSession({ sessionId, reason: "server_stop" }))
        );
    }
}

export function createDefaultSessionStore<T extends CloseableTransport>(args: {
    idleTimeoutMs: number;
    notificationTimeoutMs: number;
    logger: LoggerBase;
    metrics: Metrics<DefaultMetrics>;
}): ISessionStore<T> {
    return new SessionStore(args.idleTimeoutMs, args.notificationTimeoutMs, args.logger, args.metrics);
}
