import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export class InMemoryTransport implements Transport {
    private _input: WritableStream<JSONRPCMessage>;
    private _output: ReadableStream<JSONRPCMessage>;
    private inputWriter: WritableStreamDefaultWriter<JSONRPCMessage>;
    private outputController: ReadableStreamDefaultController<JSONRPCMessage> | undefined;
    private onMessageCallback?: (message: JSONRPCMessage) => void;
    private onCloseCallback?: () => void;
    private onErrorCallback?: (error: Error) => void;
    private otherTransport?: InMemoryTransport;

    private _sessionId?: string;

    public get sessionId(): string | undefined {
        return this._sessionId;
    }

    get input(): WritableStream<JSONRPCMessage> {
        return this._input;
    }

    get output(): ReadableStream<JSONRPCMessage> {
        return this._output;
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

    constructor() {
        // Create input writable stream (where we write messages to be received by this transport)
        this._input = new WritableStream<JSONRPCMessage>({
            write: (message) => {
                this.onMessageCallback?.(message);
            },
        });
        this.inputWriter = this._input.getWriter();

        // Create output readable stream (where messages are read from this transport)
        this._output = new ReadableStream<JSONRPCMessage>({
            start: (controller) => {
                this.outputController = controller;
            },
        });
    }

    async start(): Promise<void> {
        // No-op for in-memory transport
    }

    async close(): Promise<void> {
        this.onCloseCallback?.();
        this.otherTransport?.onCloseCallback?.();
        this.inputWriter.releaseLock();
    }

    async send(message: JSONRPCMessage): Promise<void> {
        // Write to the other transport's input
        if (this.otherTransport) {
            await this.otherTransport.inputWriter.write(message);
        }
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
