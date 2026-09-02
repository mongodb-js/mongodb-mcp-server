/**
 * Verified identity of an authenticated HTTP client (mirrors the SDK's
 * `AuthInfo`). Carried on the request context so per-request servers can scope
 * shared state (e.g. connections) by verified identity rather than
 * self-asserted headers.
 */
export type RequestAuthInfo = {
    /** The access token. */
    token: string;
    /** The client id associated with this token. */
    clientId: string;
    /** Scopes associated with this token. */
    scopes: string[];
    /** When the token expires (in seconds since epoch). */
    expiresAt?: number;
};

/**
 * The explicit authentication state of a request. Every HTTP request carries
 * one or the other — there is no "unknown" — so per-request servers always
 * know whether they are serving an authenticated client, and scope shared
 * state (e.g. connections) by the verified `clientId` when authenticated.
 * Identity is injected by the host (e.g. `req.auth` via the node adapter's
 * pass-through, or directly on the request context); the server never
 * authenticates on its own.
 */
export type RequestAuthState = { mode: "unauthenticated" } | { mode: "authenticated"; state: RequestAuthInfo };

export type TransportRequestContext = {
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
    /**
     * The explicit auth state of this request. When authenticated, shared state
     * (connections) is scoped by `state.clientId`; unauthenticated requests are
     * isolated from authenticated clients.
     */
    authInfo?: RequestAuthState;
};

export interface ITransportRunner {
    start(options: { serverOptions?: unknown; sessionOptions?: unknown }): Promise<void>;
    close(): Promise<void>;
}

export interface IServerFactory {
    createServer(options: unknown): Promise<unknown>;
}
