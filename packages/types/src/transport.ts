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
    /**
     * Additional verified claims about the token, mirroring the SDK's
     * `AuthInfo.extra`. Per-user scoping reads the OIDC `sub` claim here:
     * `clientId` identifies the OAuth client application, not the end user, so
     * deployments where several users authenticate through one shared client
     * need a per-user principal claim (carried here) for per-user isolation.
     */
    extra?: Record<string, unknown>;
};

/**
 * Decides which connection scope a request gets — i.e. which connections it
 * can see and where connections it creates are stored. Returns the scope key,
 * or `undefined` for an ephemeral scope (no cross-request state, isolated
 * from every other request).
 *
 * This is the knob that controls connection isolation: it must be keyed on
 * whatever actually distinguishes the calling principals (per-user principal,
 * OAuth client id, token, tenant, …) for correct, per-caller isolation with
 * no shared state. Keyed on `clientId` alone, for example, it groups every
 * user of one client registration together — fine for service accounts,
 * wrong for a multi-user OIDC deployment. Returning `undefined` declines
 * cross-request state for a request entirely.
 */
export type ConnectionScopePolicy = (request: TransportRequestContext) => string | undefined;

export type McpProtocol = "legacy" | "2026-07-28";

export type TransportRequestContext = {
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
    /**
     * The verified identity of this request, if the host injected one (via
     * `req.auth`, which the node adapter forwards, or directly). Absent means
     * the host did not verify an identity for this request. Connection
     * scoping and per-request authorization decisions key on this rather than
     * self-asserted headers.
     */
    authInfo?: RequestAuthInfo;
    protocol?: McpProtocol;
};

export interface ITransportRunner {
    start(options: { serverOptions?: unknown; sessionOptions?: unknown }): Promise<void>;
    close(): Promise<void>;
}

export interface IServerFactory {
    createServer(options: unknown): Promise<unknown>;
}
