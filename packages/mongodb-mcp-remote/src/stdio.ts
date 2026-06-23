import { createInterface } from "node:readline";
import type { JsonRpcMessage, JsonRpcResponse, MessageProcessor } from "./common.js";
import { JsonRpcErrorCodes, createErrorResponse } from "./common.js";
import { logger } from "./logger.js";

export class StdioTransport {
    private rl: ReturnType<typeof createInterface> | null = null;

    constructor(
        private readonly processor: MessageProcessor,
        private readonly onClose: () => void
    ) {}

    start(): void {
        this.rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

        this.rl.on("line", (line) => {
            void this.processLine(line);
        });

        this.rl.on("close", () => {
            logger.info("Stdio transport closed");
            this.onClose();
        });

        logger.info("Stdio transport started");
    }

    stop(): void {
        this.rl?.close();
        this.rl = null;
    }

    private async processLine(line: string): Promise<void> {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        let message: JsonRpcMessage;
        try {
            message = JSON.parse(trimmedLine) as JsonRpcMessage;
        } catch (error) {
            logger.error("Failed to parse JSON-RPC message", { error: String(error) });
            writeError(JsonRpcErrorCodes.PARSE_ERROR, "Parse error: invalid JSON");
            return;
        }

        if (!isValidJsonRpc(message)) {
            writeError(JsonRpcErrorCodes.INVALID_REQUEST, "Invalid Request");
            return;
        }

        const response = await this.processor.forward(message);
        if (response) {
            writeResponse(response);
        }
    }
}

function writeResponse(response: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(response) + "\n");
}

function writeError(code: number, message: string): void {
    writeResponse(createErrorResponse(null, code, message));
}

function isValidJsonRpc(message: unknown): message is JsonRpcMessage {
    return typeof message === "object" && message !== null && (message as Record<string, unknown>)["jsonrpc"] === "2.0";
}
