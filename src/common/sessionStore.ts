import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import logger, { LogId } from "./logger.js";

export class SessionStore {
    private sessions: { [sessionId: string]: StreamableHTTPServerTransport | undefined } = {};

    getSession(sessionId: string): StreamableHTTPServerTransport | undefined {
        return this.sessions[sessionId];
    }

    setSession(sessionId: string, transport: StreamableHTTPServerTransport): void {
        if (this.sessions[sessionId]) {
            throw new Error(`Session ${sessionId} already exists`);
        }
        this.sessions[sessionId] = transport;
    }

    async closeSession(sessionId: string, closeTransport: boolean = true): Promise<void> {
        if (!this.sessions[sessionId]) {
            throw new Error(`Session ${sessionId} not found`);
        }
        if (closeTransport) {
            const transport = this.sessions[sessionId];
            if (!transport) {
                throw new Error(`Session ${sessionId} not found`);
            }
            try {
                await transport.close();
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
        await Promise.all(
            Object.values(this.sessions)
                .filter((transport) => transport !== undefined)
                .map((transport) => transport.close())
        );
        this.sessions = {};
    }
}
