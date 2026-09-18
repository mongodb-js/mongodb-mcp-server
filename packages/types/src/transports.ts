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
     * When true, permits binding to a non-loopback host (e.g. `0.0.0.0`, `::`,
     * a LAN IP, or an empty host meaning "all interfaces"). Defaults to a strict
     * loopback-only policy that throws when the host is not loopback. Set this
     * explicitly only when the server is intentionally exposed to the network.
     */
    dangerousHostBinding?: boolean;
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
