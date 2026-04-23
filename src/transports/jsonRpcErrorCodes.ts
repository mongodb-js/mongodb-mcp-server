/**
 * JSON-RPC error codes for the MCP HTTP server.
 * These are defined in a separate module to avoid circular dependencies
 * between streamableHttp.ts and mcpHttpServer.ts.
 */

export const JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED = -32000;
export const JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED = -32001;
export const JSON_RPC_ERROR_CODE_SESSION_ID_INVALID = -32002;
export const JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND = -32003;
export const JSON_RPC_ERROR_CODE_INVALID_REQUEST = -32004;
export const JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION = -32005;
