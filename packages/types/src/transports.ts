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
     * Run the HTTP entry in authenticated mode. Set to `"authenticated"` to
     * require every request to carry a verified identity (hosts inject it via
     * `req.auth`, which the node adapter forwards as the handler's authInfo;
     * the server never authenticates on its own). When set, unauthenticated
     * requests are rejected with 401 and the request context's authInfo is
     * always `{ mode: "authenticated", state }`. Omit for unauthenticated
     * operation (authInfo carries whatever the host provides, defaulting to
     * `{ mode: "unauthenticated" }`).
     */
    authMode?: "authenticated";
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
