// OAuth2 Token Response
export interface TokenResponse {
    access_token: string;
    expires_in?: number;
}

export interface CachedToken {
    accessToken: string;
    expiresAt: number;
}

export const LOG_LEVELS = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
    remoteUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    remoteTimeoutMs: number;
    tokenTimeoutMs: number;
    logLevel: LogLevel;
}

// === JSON-RPC 2.0 types ===

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: string | number;
    method: string;
    params?: unknown;
}

export interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: string;
    params?: unknown;
}

export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

export interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: string | number | null;
    result?: unknown;
    error?: JsonRpcError;
}

export const JsonRpcErrorCodes = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    // Custom error codes
    TOKEN_ERROR: -32000,
    REMOTE_ERROR: -32001,
    TIMEOUT_ERROR: -32002,
} as const;

export type ProxyAwareFetch = typeof fetch;

export interface MessageProcessor {
    forward(message: JsonRpcMessage): Promise<JsonRpcResponse | null>;
}

export function createErrorResponse(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown
): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message, data } };
}
