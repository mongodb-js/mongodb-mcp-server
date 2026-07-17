/**
 * JSON-RPC error codes for the MCP HTTP server.
 * These are defined in a separate module to avoid circular dependencies
 * between streamableHttp.ts and mcpHttpServer.ts.
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
 * Returned when a request that requires an existing session is received
 * without an `Mcp-Session-Id` header. HTTP status: 400.
 */
export const JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED = -32001;

/**
 * Returned when the supplied `Mcp-Session-Id` header is malformed or otherwise
 * not acceptable for the current request (e.g. provided on an `initialize`
 * call that must allocate a new session). HTTP status: 400.
 */
export const JSON_RPC_ERROR_CODE_SESSION_ID_INVALID = -32002;

/**
 * Returned when the supplied `Mcp-Session-Id` does not match any session
 * tracked by the server's session store. HTTP status: 404.
 */
export const JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND = -32003;

/**
 * The HTTP request body could not be interpreted as a valid JSON-RPC message
 * (e.g. missing `initialize` on a session-creating request). HTTP status: 400.
 */
export const JSON_RPC_ERROR_CODE_INVALID_REQUEST = -32004;

/**
 * The client supplied an externally generated `Mcp-Session-Id` while the
 * server is configured with `externallyManagedSessions` disabled. HTTP
 * status: 400.
 */
export const JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION = -32005;

/**
 * The server has reached its configured `maxSessions` limit and cannot
 * allocate a new session. HTTP status: 503.
 */
export const JSON_RPC_ERROR_CODE_SESSION_LIMIT_EXCEEDED = -32006;
