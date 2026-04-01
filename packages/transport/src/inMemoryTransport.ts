import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export class InMemoryTransport implements Transport {
    private onMessageCallback?: (message: JSONRPCMessage) => void;
    private onCloseCallback?: () => void;
    private onErrorCallback?: (error: Error) => void;
    private otherTransport?: InMemoryTransport;

    private _sessionId?: string;

    public get sessionId(): string | undefined {
        return this._sessionId;
    }

    onmessage: (message: JSONRPCMessage) => void = (message) => {
        this.onMessageCallback?.(message);
    };

    onclose: () => void = () => {
        // Default no-op handler
    };

    onerror: (error: Error) => void = (error) => {
        // Default no-op handler
    };

    async start(): Promise<void> {
        // No-op for in-memory transport
    }

    async close(): Promise<void> {
        this.onCloseCallback?.();
        this.otherTransport?.onCloseCallback?.();
    }

    async send(message: JSONRPCMessage): Promise<void> {
        this.otherTransport?.onMessageCallback?.(message);
    }

    setOtherTransport(transport: InMemoryTransport): void {
        this.otherTransport = transport;
    }

    setCallbacks(callbacks: {
        onMessage?: (message: JSONRPCMessage) => void;
        onClose?: () => void;
        onError?: (error: Error) => void;
    }): void {
        if (callbacks.onMessage) {
            this.onMessageCallback = callbacks.onMessage;
        }
        if (callbacks.onClose) {
            this.onCloseCallback = callbacks.onClose;
        }
        if (callbacks.onError) {
            this.onErrorCallback = callbacks.onError;
        }
    }

    static createPair(): [InMemoryTransport, InMemoryTransport] {
        const client = new InMemoryTransport();
        const server = new InMemoryTransport();
        client.setOtherTransport(server);
        server.setOtherTransport(client);
        return [client, server];
    }
}
