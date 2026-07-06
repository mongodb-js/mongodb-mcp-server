import type { JSONRPCMessage, RequestId, Transport } from "@modelcontextprotocol/client";
import { SdkError } from "@modelcontextprotocol/client";
import { logger } from "./logger.js";
import { LogId } from "./logging/index.js";

const LOG_CONTEXT = "httpTransportWithSessionRecovery";

/**
 * Wrapper that handles remote MCP session recovery.
 *
 * The remote MCP server destroys idle sessions after a period of inactivity,
 * causing the next POST to return a 404 error.
 * This wrapper caches the initial "initialize" message and re-sends it to transparently establish a new session.
 */
export class HttpTransportWithSessionRecovery {
    private transport: Transport;
    private cachedInitializeMessage: JSONRPCMessage | null = null;
    private reinitPromise: Promise<void> | null = null;

    constructor(
        private readonly createTransport: () => Transport,
        private readonly onmessage: (message: JSONRPCMessage) => void
    ) {
        this.transport = this.createWiredTransport();
    }

    async start(): Promise<void> {
        await this.transport.start();
    }

    async close(): Promise<void> {
        await this.transport.close();
    }

    async send(message: JSONRPCMessage): Promise<void> {
        const isInitializeMessage = "method" in message && message.method === "initialize";
        if (isInitializeMessage) {
            this.cachedInitializeMessage = message;
        }

        // If re-initialization is already in progress, wait for it before sending the message.
        if (this.reinitPromise) {
            await this.reinitPromise;
        }

        try {
            await this.transport.send(message);
            if (isInitializeMessage) {
                logger.debug({
                    id: LogId.sessionInfo,
                    context: LOG_CONTEXT,
                    message: "Remote MCP session established",
                    attributes: { sessionId: this.transport.sessionId ?? "" },
                });
            }
        } catch (error) {
            // Re-initialize if the session expired for a request.
            const isRequest = "id" in message && message.id !== undefined;
            if (!isRequest || !this.isSessionExpiredError(error)) {
                throw error;
            }

            logger.debug({
                id: LogId.sessionExpired,
                context: LOG_CONTEXT,
                message: "Remote MCP session expired, re-initializing",
            });
            if (!this.reinitPromise) {
                this.reinitPromise = this.reinitialize().finally(() => {
                    this.reinitPromise = null;
                });
            }
            await this.reinitPromise;
            // Retry once.
            await this.transport.send(message);
        }
    }

    private async reinitialize(): Promise<void> {
        if (!this.cachedInitializeMessage) {
            throw new Error("Cannot re-initialize session: no cached initialize message");
        }

        await this.transport.close();

        const swallowResponseId =
            "id" in this.cachedInitializeMessage && this.cachedInitializeMessage.id !== undefined
                ? this.cachedInitializeMessage.id
                : undefined;
        this.transport = this.createWiredTransport({ swallowResponseId });
        await this.transport.start();

        // Re-send the cached initialize message to establish a new session.
        await this.transport.send(this.cachedInitializeMessage);

        // Replay the handshake.
        await this.transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });

        logger.debug({
            id: LogId.sessionReinitialized,
            context: LOG_CONTEXT,
            message: "Remote MCP session re-initialized successfully",
            attributes: { sessionId: this.transport.sessionId ?? "" },
        });
    }

    private createWiredTransport({ swallowResponseId }: { swallowResponseId?: RequestId } = {}): Transport {
        const transport = this.createTransport();
        let swallowed = swallowResponseId === undefined;
        transport.onmessage = (message: JSONRPCMessage): void => {
            if (!swallowed && "id" in message && message.id === swallowResponseId) {
                swallowed = true;
                return;
            }
            this.onmessage(message);
        };
        return transport;
    }

    private isSessionExpiredError(error: unknown): boolean {
        return (
            error instanceof SdkError &&
            typeof error.data === "object" &&
            error.data !== null &&
            "status" in error.data &&
            (error.data as { status: unknown }).status === 404
        );
    }
}
