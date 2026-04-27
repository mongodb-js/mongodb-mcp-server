/**
 * Generic credentials accepted by the Atlas API client. The shape varies by
 * authentication scheme; concrete implementations narrow this in the
 * `@mongodb-js/mcp-atlas-api-client` package.
 */
export type ApiClientCredentials = {
    clientId?: string;
    clientSecret?: string;
} & Record<string, unknown>;

/**
 * Request context that may be forwarded when invoking the Atlas API client.
 */
export type ApiClientRequestContext = {
    headers?: Record<string, string | string[] | undefined>;
};

/**
 * Options accepted by the API client constructor.
 *
 * Concrete implementations may extend this type with additional fields.
 */
export interface ApiClientOptions {
    baseUrl: string;
    userAgent?: string;
    credentials?: ApiClientCredentials;
    requestContext?: ApiClientRequestContext;
}

/**
 * Minimal interface that the rest of the MCP server uses when interacting
 * with the Atlas API client.
 *
 * The concrete `ApiClient` exposes many additional Atlas-specific methods;
 * those live in `@mongodb-js/mcp-atlas-api-client`. This interface only
 * captures the dependency surface that other components (telemetry, sessions)
 * actually consume.
 */
export interface ApiClientLike {
    /**
     * Whether the API client has authentication credentials configured.
     */
    isAuthConfigured(): boolean;

    /**
     * Validates the configured authentication credentials. Throws on failure.
     */
    validateAuthConfig(): Promise<void>;

    /**
     * Closes the API client, revoking any held tokens.
     */
    close(): Promise<void>;

    /**
     * Sends a batch of telemetry events through the Atlas telemetry endpoint.
     * The event payload type is left generic so that consumers of `mcp-api`
     * are not coupled to a specific telemetry event shape.
     */
    sendEvents<T>(events: T[], options?: { signal?: AbortSignal }): Promise<void>;

    /**
     * Returns information about the request originator's IP address.
     */
    getIpInfo(): Promise<{ currentIpv4Address: string }>;

    /**
     * Deletes an Atlas database user — used by `Session.disconnect()` to
     * clean up temporary users created during the session.
     */
    deleteDatabaseUser(options: unknown): Promise<unknown>;
}

/**
 * Factory for constructing an `ApiClientLike` instance.
 *
 * Concrete factories live in `@mongodb-js/mcp-atlas-api-client`.
 */
export type ApiClientFactoryFn = (options: ApiClientOptions, logger: unknown) => ApiClientLike;
