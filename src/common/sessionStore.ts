import type { LoggerBase } from "./logging/index.js";
import { LogId } from "./logging/index.js";
import type { ManagedTimeout } from "./managedTimeout.js";
import { setManagedTimeout } from "./managedTimeout.js";
import { type Server } from "../server.js";
import { type StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface ISessionStore {
    getSession(sessionId: string): Promise<StreamableHTTPServerTransport | undefined>;
    setSession(
        sessionId: string,
        sessionState: {
            transport: StreamableHTTPServerTransport;
            server: Server;
            logger: LoggerBase;
        }
    ): Promise<void>;
    closeSession(sessionId: string, closeTransport: boolean): Promise<void>;
    closeAllSessions(): Promise<void>;
}

export class SessionStore implements ISessionStore {
    private sessions: {
        [sessionId: string]: {
            logger: LoggerBase;
            transport: StreamableHTTPServerTransport;
            server: Server;
            abortTimeout: ManagedTimeout;
            notificationTimeout: ManagedTimeout;
        };
    } = {};

    constructor(
        private readonly idleTimeoutMS: number,
        private readonly notificationTimeoutMS: number,
        private readonly logger: LoggerBase
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

    // eslint-disable-next-line @typescript-eslint/require-await
    async getSession(sessionId: string): Promise<StreamableHTTPServerTransport | undefined> {
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

    // eslint-disable-next-line @typescript-eslint/require-await
    async setSession(
        sessionId: string,
        sessionState: {
            transport: StreamableHTTPServerTransport;
            server: Server;
            logger: LoggerBase;
        }
    ): Promise<void> {
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

                await this.closeSession(sessionId);
            }
        }, this.idleTimeoutMS);
        const notificationTimeout = setManagedTimeout(
            () => this.sendNotification(sessionId),
            this.notificationTimeoutMS
        );
        this.sessions[sessionId] = {
            ...sessionState,
            abortTimeout,
            notificationTimeout,
        };
    }

    async closeSession(sessionId: string, closeTransport: boolean = true): Promise<void> {
        const session = this.sessions[sessionId];
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        session.abortTimeout.cancel();
        session.notificationTimeout.cancel();
        if (closeTransport) {
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
        delete this.sessions[sessionId];
    }

    async closeAllSessions(): Promise<void> {
        await Promise.all(Object.keys(this.sessions).map((sessionId) => this.closeSession(sessionId)));
    }
}
