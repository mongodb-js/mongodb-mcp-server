import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import logger, { LogId } from "./logger.js";

export class SessionStore {
    private sessions: Map<string, StreamableHTTPServerTransport> = new Map();

    getSession(sessionId: string): StreamableHTTPServerTransport | undefined {
        return this.sessions.get(sessionId);
    }

    setSession(sessionId: string, transport: StreamableHTTPServerTransport): void {
        if (this.sessions.has(sessionId)) {
            throw new Error(`Session ${sessionId} already exists`);
        }
        this.sessions.set(sessionId, transport);
    }

    async closeSession(sessionId: string, closeTransport: boolean = true): Promise<void> {
        if (!this.sessions.has(sessionId)) {
            throw new Error(`Session ${sessionId} not found`);
        }
        if (closeTransport) {
            const transport = this.sessions.get(sessionId);
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
        this.sessions.delete(sessionId);
    }

    async closeAllSessions(): Promise<void> {
        await Promise.all(Array.from(this.sessions.values()).map((transport) => transport.close()));
        this.sessions.clear();
    }
}
