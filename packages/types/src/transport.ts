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
 * A resolved connection scope: the scope key plus whether the scope is owned
 * by the server that created the view. An owned scope is reaped when that
 * server closes (a sessionful server's session-private scope); an unowned one
 * outlives it (a shared scope, or a stateless server's named scope that must
 * persist across requests). `owned` defaults to `false` (shared).
 */
export type ConnectionScope = {
    scope: string;
    owned?: boolean;
};

/**
 * Decides which connection scope a request gets — i.e. which connections it
 * can see and where connections it creates are stored. Returns the scope key,
 * a {@link ConnectionScope} to also mark the scope owned, or `undefined` for
 * an ephemeral scope (no cross-request state, isolated from every other
 * request; always owned).
 *
 * This is the knob that controls connection isolation: it must be keyed on
 * whatever actually distinguishes the calling principals (per-user principal,
 * OAuth client id, token, tenant, …) for correct, per-caller isolation with
 * no shared state. Keyed on `clientId` alone, for example, it groups every
 * user of one client registration together — fine for service accounts,
 * wrong for a multi-user OIDC deployment. Returning `undefined` declines
 * cross-request state for a request entirely.
 *
 * A bare string is treated as an unowned (shared) scope. Mark a scope `owned`
 * only when it is private to the server instance that creates it (e.g. a
 * session id on a sessionful transport): an owned scope is reaped when that
 * server closes, so marking a shared scope owned would revoke connections
 * other servers still use.
 */
export type ConnectionScopePolicy = (request: TransportRequestContext) => string | ConnectionScope | undefined;

/**
 * The MCP protocol revision a client is using: the exact revision string the
 * client named (e.g. `"2025-11-25"`, `"2026-07-28"`), or `"legacy"` when the
 * revision could not be determined (an old client that names none).
 */
export type McpProtocol = string;

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
    /** The exact MCP protocol revision this request named, or `"legacy"` when unset. */
    mcp_client_protocol?: McpProtocol;
    /**
     * Whether the server serving this request lives for a whole session (legacy
     * 2025-era HTTP) rather than a single request (stateless 2026-era HTTP). A
     * sessionful server's connection scopes are reaped when the session ends; a
     * stateless server's outlive the request. Absent means stateless.
     */
    sessionful?: boolean;
};

export interface ITransportRunner {
    start(options: { serverOptions?: unknown; sessionOptions?: unknown }): Promise<void>;
    close(): Promise<void>;
}

export interface IServerFactory {
    createServer(options: unknown): Promise<unknown>;
}
