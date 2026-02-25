import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as oauth from "oauth4webapi";
import { ClientCredentialsAuthProvider } from "../../../../src/common/atlas/auth/clientCredentials.js";
import { NullLogger } from "../../../../tests/utils/index.js";

vi.mock("oauth4webapi", () => ({
    clientCredentialsGrantRequest: vi.fn(),
    processClientCredentialsResponse: vi.fn(),
    revocationRequest: vi.fn(),
    customFetch: Symbol("customFetch"),
}));

describe("ClientCredentialsAuthProvider", () => {
    let authProvider: ClientCredentialsAuthProvider;
    const mockOptions = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        baseUrl: "https://api.test.com",
        userAgent: "test-user-agent",
    };

    beforeEach(() => {
        vi.clearAllMocks();
        authProvider = new ClientCredentialsAuthProvider(mockOptions, new NullLogger());
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("constructor", () => {
        it("should create a provider with the correct configuration", () => {
            expect(authProvider).toBeDefined();
        });

        it("should initialize oauth2Issuer with correct endpoints", () => {
            // @ts-expect-error accessing private property for testing
            const issuer = authProvider.oauth2Issuer;
            expect(issuer).toBeDefined();
            expect(issuer?.issuer).toBe(mockOptions.baseUrl);
            expect(issuer?.token_endpoint).toBe("https://api.test.com/api/oauth/token");
            expect(issuer?.revocation_endpoint).toBe("https://api.test.com/api/oauth/revoke");
        });
    });

    describe("validate", () => {
        it("should return false when credentials are not set", async () => {
            // @ts-expect-error accessing private property for testing
            authProvider.oauth2Issuer = undefined;
            const isValid = await authProvider.validate();
            expect(isValid).toBe(false);
        });

        it("should return true when existing token is valid", async () => {
            const mockToken = "valid-access-token";
            const expiresAt = Date.now() + 3600000; // 1 hour from now

            // @ts-expect-error accessing private property for testing
            authProvider.accessToken = {
                access_token: mockToken,
                expires_at: expiresAt,
            };

            const isValid = await authProvider.validate();
            expect(isValid).toBe(true);
            expect(oauth.clientCredentialsGrantRequest).not.toHaveBeenCalled();
        });

        it("should return true when fetching new token succeeds", async () => {
            const expiredToken = "expired-access-token";
            const expiresAt = Date.now() - 1000; // 1 second ago (expired)
            const newToken = "new-access-token";

            // @ts-expect-error accessing private property for testing
            authProvider.accessToken = {
                access_token: expiredToken,
                expires_at: expiresAt,
            };

            const mockResponse = new Response(
                JSON.stringify({
                    access_token: newToken,
                    expires_in: 3600,
                }),
                { status: 200 }
            );

            vi.mocked(oauth.clientCredentialsGrantRequest).mockResolvedValue(mockResponse);
            vi.mocked(oauth.processClientCredentialsResponse).mockResolvedValue({
                access_token: newToken,
                expires_in: 3600,
            } as Awaited<ReturnType<typeof oauth.processClientCredentialsResponse>>);

            const isValid = await authProvider.validate();
            expect(isValid).toBe(true);
            expect(oauth.clientCredentialsGrantRequest).toHaveBeenCalled();
        });

        it("should return true when fetching new token when no token exists", async () => {
            const newToken = "new-access-token";

            const mockResponse = new Response(
                JSON.stringify({
                    access_token: newToken,
                    expires_in: 3600,
                }),
                { status: 200 }
            );

            vi.mocked(oauth.clientCredentialsGrantRequest).mockResolvedValue(mockResponse);
            vi.mocked(oauth.processClientCredentialsResponse).mockResolvedValue({
                access_token: newToken,
                expires_in: 3600,
            } as Awaited<ReturnType<typeof oauth.processClientCredentialsResponse>>);

            const isValid = await authProvider.validate();
            expect(isValid).toBe(true);

            expect(oauth.clientCredentialsGrantRequest).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.objectContaining({
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    [oauth.customFetch]: expect.anything(),
                    headers: {
                        "User-Agent": mockOptions.userAgent,
                    },
                })
            );
        });

        it("should return false when fetching token fails", async () => {
            const error = new Error("Failed to fetch token");
            vi.mocked(oauth.clientCredentialsGrantRequest).mockRejectedValue(error);

            const isValid = await authProvider.validate();
            expect(isValid).toBe(false);
            expect(oauth.clientCredentialsGrantRequest).toHaveBeenCalled();
        });
    });

    describe("getAuthHeaders", () => {
        it("should return headers with Bearer token when token is available", async () => {
            const mockToken = "test-access-token";
            const expiresAt = Date.now() + 3600000;

            // @ts-expect-error accessing private property for testing
            authProvider.accessToken = {
                access_token: mockToken,
                expires_at: expiresAt,
            };

            const headers = await authProvider.getAuthHeaders();
            expect(headers).toEqual({
                Authorization: `Bearer ${mockToken}`,
            });
        });
    });

    describe("revoke", () => {
        it("should revoke access token when token exists", async () => {
            const mockToken = "test-access-token";
            const expiresAt = Date.now() + 3600000;

            // @ts-expect-error accessing private property for testing
            authProvider.accessToken = {
                access_token: mockToken,
                expires_at: expiresAt,
            };

            const mockRevocationResponse = new Response(null, { status: 200 });
            vi.mocked(oauth.revocationRequest).mockResolvedValue(mockRevocationResponse);

            await authProvider.revoke();

            expect(oauth.revocationRequest).toHaveBeenCalled();
            // @ts-expect-error accessing private property for testing
            expect(authProvider.accessToken).toBeUndefined();
        });
    });
});
