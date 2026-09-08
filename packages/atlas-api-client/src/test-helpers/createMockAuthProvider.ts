import { AuthProviderFactory, type AuthProvider } from "@mongodb-js/mcp-atlas-api-client";
import { NoopLogger } from "@mongodb-js/mcp-core";

const MOCK_USER_AGENT = "test-user-agent";

const defaultHttpClient = {
    fetch: globalThis.fetch.bind(globalThis),
    Request: globalThis.Request,
};

/**
 * Builds an AuthProvider for unit tests. Real network calls are never made
 * because an injected (or default) httpClient is supplied.
 */
export function createMockAuthProvider(
    baseUrl = "https://example.com",
    httpClient = defaultHttpClient
): AuthProvider | undefined {
    return AuthProviderFactory.create(
        {
            apiBaseUrl: baseUrl,
            userAgent: MOCK_USER_AGENT,
            credentials: { clientId: "test-client-id", clientSecret: "test-client-secret" },
            httpClient,
        },
        new NoopLogger()
    );
}
