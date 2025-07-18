import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import logger, { LogId, McpLogger } from "./logger.js";

export class SessionStore {
    private sessions: {
        [sessionId: string]: {
            mcpServer: McpServer;
            transport: StreamableHTTPServerTransport;
            abortController: AbortController;
            abortTimeoutId: NodeJS.Timeout;
            notificationTimeoutId: NodeJS.Timeout;
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

        if (session.abortTimeoutId) {
            clearTimeout(session.abortTimeoutId);
        }
        const abortTimeoutId = setTimeout(() => {
            session.abortController.abort();
        }, this.idleTimeoutMS);
        session.abortTimeoutId = abortTimeoutId;

        if (session.notificationTimeoutId) {
            clearTimeout(session.notificationTimeoutId);
        }
        const notificationTimeoutId = setTimeout(() => {
            this.sendNotification(sessionId);
        }, this.notificationTimeoutMS);
        session.notificationTimeoutId = notificationTimeoutId;
    }

    private sendNotification(sessionId: string): void {
        const session = this.sessions[sessionId];
        if (!session) {
            return;
        }
        const logger = new McpLogger(session.mcpServer);
        logger.info(
            LogId.streamableHttpTransportSessionCloseNotification,
            "sessionStore",
            "Session is about to be closed due to inactivity"
        );
    }

    setSession(sessionId: string, transport: StreamableHTTPServerTransport, mcpServer: McpServer): void {
        if (this.sessions[sessionId]) {
            throw new Error(`Session ${sessionId} already exists`);
        }
        const abortController = new AbortController();
        const abortTimeoutId = setTimeout(() => {
            abortController.abort();
        }, this.idleTimeoutMS);
        const notificationTimeoutId = setTimeout(() => {
            this.sendNotification(sessionId);
        }, this.notificationTimeoutMS);
        this.sessions[sessionId] = { mcpServer, transport, abortController, abortTimeoutId, notificationTimeoutId };
        abortController.signal.onabort = async () => {
            await this.closeSession(sessionId);
        };
    }

    async closeSession(sessionId: string, closeTransport: boolean = true): Promise<void> {
        if (!this.sessions[sessionId]) {
            throw new Error(`Session ${sessionId} not found`);
        }
        clearTimeout(this.sessions[sessionId].abortTimeoutId);
        clearTimeout(this.sessions[sessionId].notificationTimeoutId);
        if (closeTransport) {
            try {
                const logger = new McpLogger(this.sessions[sessionId].mcpServer);
                logger.info(
                    LogId.streamableHttpTransportSessionCloseNotification,
                    "sessionStore",
                    "Session closed, please reconnect"
                );
                await this.sessions[sessionId].transport.close();
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
        await Promise.all(Object.values(this.sessions).map((session) => session.abortController.abort()));
        this.sessions = {};
    }
}
