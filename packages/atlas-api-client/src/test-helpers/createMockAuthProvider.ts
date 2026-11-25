import { AuthProviderFactory, type AuthProvider, type HttpClient } from "@mongodb-js/mcp-atlas-api-client";
import { NoopLogger } from "@mongodb-js/mcp-core";
import { createMockHttpClient } from "./createMockHttpClient.js";

const MOCK_USER_AGENT = "test-user-agent";

/**
 * Builds an AuthProvider for unit tests. Real network calls are never made
 * because the default httpClient rejects any unexpected request.
 */
export function createMockAuthProvider(
    baseUrl = "https://example.com",
    httpClient: HttpClient = createMockHttpClient()
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
