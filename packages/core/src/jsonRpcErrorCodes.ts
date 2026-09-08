/**
 * JSON-RPC error codes for the MCP HTTP server.
 * These are defined in a separate module to avoid circular dependencies.
 *
 * The values fall in the JSON-RPC implementation-defined server error range
 * (`-32000` to `-32099`) and are returned in the `error.code` field of
 * JSON-RPC responses sent over the streamable HTTP transport.
 */

/**
 * Generic failure while processing an otherwise valid JSON-RPC request
 * (e.g. an unhandled exception thrown by the MCP server). HTTP status: 500.
 */
export const JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED = -32000;

/**
 * The HTTP request body could not be interpreted as a valid JSON-RPC message.
 * HTTP status: 400.
 */
export const JSON_RPC_ERROR_CODE_INVALID_REQUEST = -32004;
