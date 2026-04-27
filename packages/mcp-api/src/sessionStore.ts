import type { ILoggerBase } from "./logging.js";

/**
 * Minimal interface for a transport that can be stored in a SessionStore.
 * The transport must have a close method for cleanup.
 */
export type CloseableTransport = {
    close(): Promise<void>;
};

export type SessionCloseReason = "idle_timeout" | "transport_closed" | "server_stop" | "unknown";

/**
 * Interface for managing MCP transport sessions.
 *
 * Implement this interface to provide custom session storage and lifecycle
 * management (e.g. database-based session storage).
 */
export interface ISessionStore<T extends CloseableTransport = CloseableTransport> {
    getSession(sessionId: string): Promise<T | undefined>;
    addSession(params: { sessionId: string; transport: T; logger: ILoggerBase }): Promise<void>;
    closeSession(params: { sessionId: string; reason?: SessionCloseReason }): Promise<void>;
    closeAllSessions(): Promise<void>;
}

/**
 * Constructor arguments for creating a SessionStore instance.
 */
export type SessionStoreConstructorArgs<TMetrics = unknown> = {
    options: { idleTimeoutMS: number; notificationTimeoutMS: number };
    logger: ILoggerBase;
    metrics: TMetrics;
};

/**
 * A function to create a custom SessionStore instance.
 * When provided, the runner will use this function instead of the default SessionStore constructor.
 */
export type CreateSessionStoreFn<
    TTransport extends CloseableTransport = CloseableTransport,
    TMetrics = unknown,
> = (args: SessionStoreConstructorArgs<TMetrics>) => ISessionStore<TTransport>;
