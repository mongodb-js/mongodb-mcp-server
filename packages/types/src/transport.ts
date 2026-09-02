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
 * Resolves the verified identity of an inbound HTTP request from its raw
 * headers (e.g. by validating `Authorization: Bearer <token>` with OAuth2
 * introspection, JWKS, a shared secret, ...). This is the single auth
 * injection point for multi-tenant deployments: provide it and the server
 * requires every request to authenticate (unverified requests get 401) and
 * scopes state by the returned `clientId`. Omit it for unauthenticated
 * operation. The shape mirrors the Atlas API `AuthProvider` — a small
 * pluggable strategy supplied by the embedder, no config schema additions.
 */
export type RequestAuthenticator = (
    headers: Record<string, string | string[] | undefined>
) => Promise<RequestAuthInfo | undefined>;

export type TransportRequestContext = {
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
    /** Verified identity of the authenticated HTTP client, when auth is configured. */
    authInfo?: RequestAuthInfo;
};

export interface ITransportRunner {
    start(options: { serverOptions?: unknown; sessionOptions?: unknown }): Promise<void>;
    close(): Promise<void>;
}

export interface IServerFactory {
    createServer(options: unknown): Promise<unknown>;
}
