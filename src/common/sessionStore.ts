import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import logger, { LogId, LoggerBase, McpLogger } from "./logger.js";
import { TimeoutManager } from "./timeoutManager.js";

export class SessionStore {
    private sessions: {
        [sessionId: string]: {
            logger: LoggerBase;
            transport: StreamableHTTPServerTransport;
            abortTimeout: TimeoutManager;
            notificationTimeout: TimeoutManager;
        };
    } = {};

    constructor(
        private readonly idleTimeoutMS: number,
        private readonly notificationTimeoutMS: number
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

    getSession(sessionId: string): StreamableHTTPServerTransport | undefined {
        this.resetTimeout(sessionId);
        return this.sessions[sessionId]?.transport;
    }

    private resetTimeout(sessionId: string): void {
        const session = this.sessions[sessionId];
        if (!session) {
            return;
        }

        session.abortTimeout.reset();

        session.notificationTimeout.reset();
    }

    private sendNotification(sessionId: string): void {
        const session = this.sessions[sessionId];
        if (!session) {
            logger.warning(
                LogId.streamableHttpTransportSessionCloseNotificationFailure,
                "sessionStore",
                `session ${sessionId} not found, no notification delivered`
            );
            return;
        }
        session.logger.info(
            LogId.streamableHttpTransportSessionCloseNotification,
            "sessionStore",
            "Session is about to be closed due to inactivity"
        );
    }

    setSession(sessionId: string, transport: StreamableHTTPServerTransport, mcpServer: McpServer): void {
        const session = this.sessions[sessionId];
        if (session) {
            throw new Error(`Session ${sessionId} already exists`);
        }
        const abortTimeout = new TimeoutManager(async () => {
            if (this.sessions[sessionId]) {
                this.sessions[sessionId].logger.info(
                    LogId.streamableHttpTransportSessionCloseNotification,
                    "sessionStore",
                    "Session closed due to inactivity"
                );

                await this.closeSession(sessionId);
            }
        }, this.idleTimeoutMS);
        const notificationTimeout = new TimeoutManager(
            () => this.sendNotification(sessionId),
            this.notificationTimeoutMS
        );
        this.sessions[sessionId] = { logger: new McpLogger(mcpServer), transport, abortTimeout, notificationTimeout };
    }

    async closeSession(sessionId: string, closeTransport: boolean = true): Promise<void> {
        const session = this.sessions[sessionId];
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        session.abortTimeout.clear();
        session.notificationTimeout.clear();
        if (closeTransport) {
            try {
                await session.transport.close();
            } catch (error) {
                logger.error(
                    LogId.streamableHttpTransportSessionCloseFailure,
                    "streamableHttpTransport",
                    `Error closing transport ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
        delete this.sessions[sessionId];
    }

    async closeAllSessions(): Promise<void> {
        await Promise.all(Object.keys(this.sessions).map((sessionId) => this.closeSession(sessionId)));
    }
}
