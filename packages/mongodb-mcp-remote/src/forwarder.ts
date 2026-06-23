import type {
    JsonRpcMessage,
    JsonRpcNotification,
    JsonRpcRequest,
    JsonRpcResponse,
    MessageProcessor,
    ProxyAwareFetch,
} from "./common.js";
import { JsonRpcErrorCodes, createErrorResponse } from "./common.js";

import type { TokenManager } from "./tokenManager.js";
import { TokenError } from "./tokenManager.js";
import { logger } from "./logger.js";

class AuthError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "AuthError";
    }
}

class RemoteError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "RemoteError";
    }
}

class TimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TimeoutError";
    }
}

export class Forwarder implements MessageProcessor {
    private sessionId: string | null = null;

    constructor(
        private readonly remoteUrl: string,
        private readonly tokenManager: TokenManager,
        private readonly timeoutMs: number,
        private readonly fetch: ProxyAwareFetch
    ) {}

    async forward(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
        if (isRequest(message)) {
            try {
                const response = await this.send(message);
                return this.parseResponse(response, message.id);
            } catch (error: unknown) {
                return this.errorToResponse(message.id, error);
            }
        } else if (isNotification(message)) {
            try {
                await this.send(message);
            } catch (error: unknown) {
                logger.warning(`Failed to forward notification: ${String(error)}`);
            }
        }

        return null;
    }

    private async send(message: JsonRpcMessage): Promise<Response> {
        try {
            return await this.post(message);
        } catch (error: unknown) {
            if (error instanceof AuthError) {
                logger.debug("Auth error, retrying");
                return this.post(message);
            }
            throw error;
        }
    }

    private async post(message: JsonRpcMessage): Promise<Response> {
        const token = await this.tokenManager.getToken();

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            Authorization: `Bearer ${token}`,
        };
        if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

        const body =
            "method" in message && !("params" in message)
                ? JSON.stringify({ ...message, params: {} })
                : JSON.stringify(message);

        const response = await this.fetch(this.remoteUrl, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(this.timeoutMs),
        }).catch((error: unknown) => {
            if (error instanceof Error) {
                if (error.name === "TimeoutError") {
                    throw new TimeoutError(`Request timed out after ${this.timeoutMs}ms`);
                }
                throw new RemoteError(`Request failed: ${error.message}`, 0);
            }
            throw new RemoteError(`Request failed: ${String(error)}`, 0);
        });

        const resSessionId = response.headers.get("Mcp-Session-Id");
        if (resSessionId) this.sessionId = resSessionId;

        if (response.status === 401 || response.status === 403) {
            const errorBody = await response.text();
            this.tokenManager.invalidateToken();
            throw new AuthError(`Authentication failed with status ${response.status}: ${errorBody}`, response.status);
        }

        return response;
    }

    private async parseResponse(response: Response, messageId: string | number): Promise<JsonRpcResponse> {
        if (!response.ok) {
            try {
                // Server always returns a JSON-RPC error body, except for 413 (Content Too Large).
                const body = (await response.json()) as JsonRpcResponse;
                return { ...body, id: messageId };
            } catch {
                throw new RemoteError(`Remote server error ${response.status}`, response.status);
            }
        }

        const contentType = response.headers.get("Content-Type") ?? "";
        let parsed: JsonRpcResponse;
        if (contentType.includes("text/event-stream")) {
            const body = await response.text();
            parsed = this.parseSSEBody(body);
        } else {
            parsed = (await response.json()) as JsonRpcResponse;
        }

        if (parsed.jsonrpc !== "2.0") {
            throw new RemoteError("Invalid JSON-RPC response from remote server", 0);
        }

        return parsed;
    }

    private parseSSEBody(body: string): JsonRpcResponse {
        const dataLines = body
            .split(/\r\n|\r|\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart());

        if (dataLines.length === 0) {
            throw new RemoteError("No data found in SSE response", 0);
        }

        try {
            return JSON.parse(dataLines.join("\n")) as JsonRpcResponse;
        } catch {
            throw new RemoteError("Failed to parse SSE response as JSON", 0);
        }
    }

    private errorToResponse(id: string | number, error: unknown): JsonRpcResponse {
        if (error instanceof TokenError) {
            return createErrorResponse(id, JsonRpcErrorCodes.TOKEN_ERROR, `Token error: ${error.message}`, {
                statusCode: error.statusCode,
            });
        }
        if (error instanceof AuthError) {
            return createErrorResponse(id, JsonRpcErrorCodes.TOKEN_ERROR, `Authentication error: ${error.message}`, {
                statusCode: error.statusCode,
            });
        }
        if (error instanceof TimeoutError) {
            return createErrorResponse(id, JsonRpcErrorCodes.TIMEOUT_ERROR, error.message);
        }
        if (error instanceof RemoteError) {
            return createErrorResponse(id, JsonRpcErrorCodes.REMOTE_ERROR, error.message, {
                statusCode: error.statusCode,
            });
        }
        return createErrorResponse(
            id,
            JsonRpcErrorCodes.INTERNAL_ERROR,
            `Internal error: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
    return "method" in message && "id" in message;
}

function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
    return "method" in message && !("id" in message);
}
