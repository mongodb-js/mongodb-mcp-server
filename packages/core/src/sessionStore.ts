import type { ILogger, IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import { setManagedTimeout, type ManagedTimeout } from "./managedTimeout.js";
import { LogId } from "./logId.js";

/** Default cap on concurrent sessions when {@link LegacySessionOptions.maxSessions} is omitted. */
export const DEFAULT_MAX_SESSIONS = 1000;
/** Default idle grace (ms) before the LRU session may be evicted to admit a new one at the cap. */
export const DEFAULT_EVICTION_IDLE_GRACE_MS = 120_000;
/** Default session idle timeout (ms) after which the reaper closes the session. */
const DEFAULT_IDLE_TIMEOUT_MS = 600_000;
/** Default notification timeout (ms) after which an idle session is about to be closed. */
const DEFAULT_NOTIFICATION_TIMEOUT_MS = 540_000;

/** How a session can leave the store: evicted at the cap, or closed by a lifecycle timeout. */
export type SessionCloseReason = "idle_timeout" | "transport_closed" | "server_stop" | "unknown" | "evicted";

/** Thrown when the concurrent-session cap is reached and no idle session is eligible for eviction. */
export class SessionLimitExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SessionLimitExceededError";
    }
}

/** Error thrown from `getSession` to reject a session request (e.g. a failed identity check). */
export class SessionRejectedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SessionRejectedError";
    }
}

/** Tunables for the 2025-era session lifecycle. */
export type LegacySessionOptions = {
    /**
     * Maximum number of concurrent sessions held in memory. Defaults to 1000
     * ({@link DEFAULT_MAX_SESSIONS}). At the cap the least-recently-used idle
     * session is evicted (if one is idle past {@link evictionIdleGraceMS}) to
     * admit a new session; otherwise the startup is rejected with a
     * session-limit error.
     */
    maxSessions?: number;
    /**
     * A session idle longer than this (ms) is closed by the background reaper
     * to free memory (default: 600_000). Must be greater than
     * {@link notificationTimeoutMS}.
     */
    idleTimeoutMS?: number;
    /**
     * A session whose client has not refreshed the SSE/notification channel
     * within this many ms is about to be closed (default: 540_000).
     */
    notificationTimeoutMS?: number;
    /**
     * Minimum idle time (ms) a session must have before it is eligible for LRU
     * eviction at the `maxSessions` cap. Defaults to
     * {@link DEFAULT_EVICTION_IDLE_GRACE_MS}, clamped to `idleTimeoutMS`. Must
     * be < `idleTimeoutMS` (the reaper already removes anything past that), or
     * the valve never fires.
     */
    evictionIdleGraceMS?: number;
};

/** Called when the store closes a session (eviction or timeout) so the holder can tear it down. */
export type SessionCloseHandler<T> = (value: T, reason: SessionCloseReason) => void | Promise<void>;

export type LegacySessionStoreConstructorArgs<T> = {
    options?: LegacySessionOptions;
    logger: ILogger;
    metrics: IMetrics<DefaultMetricDefinitions>;
    /** Called when a session leaves the store, so the holder can tear it down. */
    onSessionClosed: SessionCloseHandler<T>;
};

/**
 * Default in-memory session store. Mirrors the sessionful `LegacySessionStore`
 * removed with the session concept: sessions are keyed by id, bounded by
 * `maxSessions`, kept alive by an idle `abortTimeout` and a `notificationTimeout`
 * (both managed), and at the cap the least-recently-used session idle past
 * `evictionIdleGraceMS` is evicted to admit a newcomer.
 *
 * It is generic over the held value (the handler's per-session object) rather
 * than a transport, so the holder can close whatever it needs; every session
 * that leaves is reported through {@link onSessionClosed}.
 */
export class LegacySessionStore<T> {
    private readonly sessions = new Map<
        string,
        {
            value: T;
            abortTimeout: ManagedTimeout;
            notificationTimeout: ManagedTimeout;
            /** Epoch ms of the last activity on this session; drives LRU eviction order. */
            lastUsedAt: number;
        }
    >();
    private readonly maxSessions: number;
    private readonly idleTimeoutMS: number;
    private readonly notificationTimeoutMS: number;
    private readonly evictionIdleGraceMS: number;
    private readonly logger: ILogger;
    private readonly metrics: IMetrics<DefaultMetricDefinitions>;
    private readonly onSessionClosed: SessionCloseHandler<T>;

    constructor({ options, logger, metrics, onSessionClosed }: LegacySessionStoreConstructorArgs<T>) {
        this.maxSessions = options?.maxSessions ?? DEFAULT_MAX_SESSIONS;
        this.idleTimeoutMS = options?.idleTimeoutMS ?? DEFAULT_IDLE_TIMEOUT_MS;
        this.notificationTimeoutMS = options?.notificationTimeoutMS ?? DEFAULT_NOTIFICATION_TIMEOUT_MS;
        // The reaper already removes sessions idle past idleTimeoutMS, so a larger
        // grace would make eviction a no-op.
        this.evictionIdleGraceMS = Math.min(
            options?.evictionIdleGraceMS ?? DEFAULT_EVICTION_IDLE_GRACE_MS,
            this.idleTimeoutMS
        );
        this.logger = logger;
        this.metrics = metrics;
        this.onSessionClosed = onSessionClosed;

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

    /** The number of live sessions currently held. */
    public get size(): number {
        return this.sessions.size;
    }

    public hasSession(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    /**
     * Returns the session value for the given id, resetting the session's idle
     * (and notification) timeouts so the activity extends its lifetime. Returns
     * `undefined` when the session does not exist.
     */
    public getSession(sessionId: string): T | undefined {
        this.resetTimeout(sessionId);
        return this.sessions.get(sessionId)?.value;
    }

    /**
     * Registers a new session. When at `maxSessions`, first evicts the
     * least-recently-used session idle past `evictionIdleGraceMS` to make room;
     * if nothing is idle enough it throws {@link SessionLimitExceededError}.
     */
    public addSession({ sessionId, value }: { sessionId: string; value: T }): void {
        if (this.sessions.has(sessionId)) {
            throw new Error(`Session ${sessionId} already exists`);
        }
        if (this.sessions.size >= this.maxSessions) {
            // At capacity: rather than hard-rejecting, evict the least-recently-used
            // session if it has been idle at least evictionIdleGraceMS — a local-only
            // close that frees a slot while the evicted client can transparently
            // re-hydrate on its next request. If nothing is idle enough, reject. This
            // stays fully synchronous (no await before the insert below), so concurrent
            // addSession calls run to completion one at a time and can't race past the cap.
            const victimId = this.findEvictableSession();
            if (victimId === undefined) {
                this.logger.warning({
                    id: LogId.streamableHttpTransportSessionLimitExceeded,
                    context: "sessionStore",
                    message: `Refusing to create session ${sessionId}: maxSessions limit of ${this.maxSessions} reached and no session is idle past the eviction grace`,
                });
                throw new SessionLimitExceededError(`Session limit of ${this.maxSessions} concurrent sessions reached`);
            }
            void this.closeSession({ sessionId: victimId, reason: "evicted" }).catch((error) => {
                this.logger.error({
                    id: LogId.streamableHttpTransportCloseFailure,
                    context: "sessionStore",
                    message: `Error evicting session ${victimId}: ${error instanceof Error ? error.message : String(error)}`,
                });
            });
        }
        const abortTimeout = setManagedTimeout(async () => {
            if (this.sessions.has(sessionId)) {
                await this.closeSession({ sessionId, reason: "idle_timeout" });
            }
        }, this.idleTimeoutMS);
        const notificationTimeout = setManagedTimeout(() => {
            this.sendNotification(sessionId);
        }, this.notificationTimeoutMS);
        this.sessions.set(sessionId, {
            value,
            abortTimeout,
            notificationTimeout,
            lastUsedAt: Date.now(),
        });
        this.metrics.get("sessionCreated").inc();
        this.metrics.get("sessionsActive").set(this.sessions.size);
    }

    /**
     * Closes a session: removes it from the map, cancels its timers, and reports
     * the value through {@link onSessionClosed} for teardown. When `reason` is
     * `"transport_closed"` the holder initiates the teardown, so it is reported
     * but not double-torn-down by the store.
     */
    public async closeSession({
        sessionId,
        reason = "unknown",
    }: {
        sessionId: string;
        reason?: SessionCloseReason;
    }): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        // Remove from map before reporting so a re-entrant callback sees the
        // session as already gone.
        this.sessions.delete(sessionId);
        session.abortTimeout.cancel();
        session.notificationTimeout.cancel();
        this.metrics.get("sessionClosed").inc({ reason });
        this.metrics.get("sessionsActive").set(this.sessions.size);
        await Promise.resolve(this.onSessionClosed(session.value, reason));
    }

    /** Closes every live session (e.g. on server shutdown). */
    public async closeAllSessions(): Promise<void> {
        await Promise.all(
            [...this.sessions.keys()].map((sessionId) => this.closeSession({ sessionId, reason: "server_stop" }))
        );
    }

    private resetTimeout(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }
        session.abortTimeout.restart();
        session.notificationTimeout.restart();
        session.lastUsedAt = Date.now();
    }

    private findEvictableSession(): string | undefined {
        const now = Date.now();
        let oldestId: string | undefined;
        let oldestLastUsedAt = Infinity;
        for (const [id, session] of this.sessions) {
            if (session.lastUsedAt < oldestLastUsedAt) {
                oldestLastUsedAt = session.lastUsedAt;
                oldestId = id;
            }
        }
        if (oldestId === undefined || now - oldestLastUsedAt < this.evictionIdleGraceMS) {
            return undefined;
        }
        return oldestId;
    }

    private sendNotification(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            this.logger.warning({
                id: LogId.sessionCloseNotificationFailure,
                context: "sessionStore",
                message: `session ${sessionId} not found, no notification delivered`,
            });
            return;
        }
        this.logger.info({
            id: LogId.sessionCloseNotification,
            context: "sessionStore",
            message: "Session is about to be closed due to inactivity",
        });
    }
}
