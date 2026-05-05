import type { ILogger } from "./logging.js";
import type { IMetrics } from "./metrics.js";

export type CloseableTransport = {
    close(): Promise<void>;
};

export type SessionCloseReason = "idle_timeout" | "transport_closed" | "server_stop" | "unknown";

export interface ISessionStore<T extends CloseableTransport = CloseableTransport> {
    getSession(sessionId: string): Promise<T | undefined>;
    addSession(params: { sessionId: string; transport: T; logger: ILogger }): Promise<void>;
    closeSession(params: { sessionId: string; reason?: SessionCloseReason }): Promise<void>;
    closeAllSessions(): Promise<void>;
}

export type SessionStoreConstructorArgs = {
    options: { idleTimeoutMS: number; notificationTimeoutMS: number };
    logger: ILogger;
    metrics: IMetrics;
};

export type CreateSessionStoreFn<TTransport extends CloseableTransport = CloseableTransport> = (
    args: SessionStoreConstructorArgs
) => ISessionStore<TTransport>;
