import type { RequestAuthenticator } from "./transport.js";

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
     * Resolves the verified identity of each inbound request (multi-tenant
     * deployments). REQUIRED for authenticated operation: provide it and the
     * server rejects requests it cannot verify with 401, and scopes shared
     * state (connections) by the verified `clientId` — never by self-asserted
     * headers. Omit it for unauthenticated operation. Embedders supply the
     * implementation at construction; there is no config schema for it.
     */
    authenticate?: RequestAuthenticator;
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
