/**
 * Options for configuring the HTTP server (host, port, etc).
 */
export type HttpServerOptions = {
    /** Host to bind the HTTP server to */
    host: string;
    /** Port to bind the HTTP server to */
    port: number;
    /** Maximum HTTP body size in bytes */
    bodyLimit?: number;
    /** Headers to validate */
    headers?: Record<string, string>;
    /** Response type: 'sse' for Server-Sent Events, 'json' for JSON responses */
    responseType?: "sse" | "json";
    /**
     * The HTTP entry's auth mode (required — there is no implicit default so a
     * deployment's posture is always explicit):
     *
     * - `"authenticated"`: every request must carry a verified identity (hosts
     *   inject it via `req.auth`, which the node adapter forwards as the
     *   handler's authInfo; the server never authenticates on its own).
     *   Unauthenticated requests are rejected with 401 and the request
     *   context's authInfo is always `{ mode: "authenticated", state }`.
     * - `"unauthenticated"`: authInfo carries whatever the host provides,
     *   defaulting to `{ mode: "unauthenticated" }`.
     */
    authMode: "authenticated" | "unauthenticated";
};

/**
 * Options for transport runners.
 */
export type TransportRunnerOptions = {
    /** Server name */
    name: string;
    /** Server version */
    version: string;
};
