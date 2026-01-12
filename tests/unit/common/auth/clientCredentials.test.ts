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
            expect(authProvider.hasCredentials()).toBe(true);
        });

        it("should initialize oauth2Issuer with correct endpoints", () => {
            // @ts-expect-error accessing private property for testing
            const issuer = authProvider.oauth2Issuer;
            expect(issuer).toBeDefined();
            expect(issuer?.issuer).toBe(mockOptions.baseUrl);
            expect(issuer?.token_endpoint).toBe("https://api.test.com/api/oauth/token");
            expect(issuer?.revocation_endpoint).toBe("https://api.test.com/api/oauth/revoke");
        });

        it("should initialize oauth2Client with credentials", () => {
            // @ts-expect-error accessing private property for testing
            const client = authProvider.oauth2Client;
            expect(client).toBeDefined();
            expect(client?.client_id).toBe(mockOptions.clientId);
            expect(client?.client_secret).toBe(mockOptions.clientSecret);
        });
    });

    describe("hasCredentials", () => {
        it("should return true when credentials are set", () => {
            expect(authProvider.hasCredentials()).toBe(true);
        });

        it("should return false when oauth2Client is undefined", () => {
            // @ts-expect-error accessing private property for testing
            authProvider.oauth2Client = undefined;
            expect(authProvider.hasCredentials()).toBe(false);
        });

        it("should return false when oauth2Issuer is undefined", () => {
            // @ts-expect-error accessing private property for testing
            authProvider.oauth2Issuer = undefined;
            expect(authProvider.hasCredentials()).toBe(false);
        });
    });

    describe("getAccessToken", () => {
        it("should return undefined when credentials are not set", async () => {
            // @ts-expect-error accessing private property for testing
            authProvider.oauth2Client = undefined;
            const token = await authProvider.getAccessToken();
            expect(token).toBeUndefined();
        });

        it("should return existing token when it is valid", async () => {
            const mockToken = "valid-access-token";
            const expiresAt = Date.now() + 3600000; // 1 hour from now

            // @ts-expect-error accessing private property for testing
            authProvider.accessToken = {
                access_token: mockToken,
                expires_at: expiresAt,
            };

            const token = await authProvider.getAccessToken();
            expect(token).toBe(mockToken);
            expect(oauth.clientCredentialsGrantRequest).not.toHaveBeenCalled();
        });

        it("should fetch new token when existing token is expired", async () => {
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

            const token = await authProvider.getAccessToken();
            expect(token).toBe(newToken);
            expect(oauth.clientCredentialsGrantRequest).toHaveBeenCalled();
        });

        it("should fetch new token when no token exists", async () => {
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

            const token = await authProvider.getAccessToken();
            expect(token).toBe(newToken);

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

        it("should handle errors when fetching token fails", async () => {
            const error = new Error("Failed to fetch token");
            vi.mocked(oauth.clientCredentialsGrantRequest).mockRejectedValue(error);

            const token = await authProvider.getAccessToken();
            expect(token).toBeUndefined();
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

    describe("revokeAccessToken", () => {
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

            await authProvider.revokeAccessToken();

            expect(oauth.revocationRequest).toHaveBeenCalled();
            // @ts-expect-error accessing private property for testing
            expect(authProvider.accessToken).toBeUndefined();
        });
    });

    describe("middleware", () => {
        it("should add Authorization header for non-unauth endpoints", async () => {
            const mockToken = "test-access-token";
            const expiresAt = Date.now() + 3600000;

            // @ts-expect-error accessing private property for testing
            authProvider.accessToken = {
                access_token: mockToken,
                expires_at: expiresAt,
            };

            const middleware = authProvider.middleware();
            const request = new Request("https://api.test.com/api/atlas/v2/groups");
            const result = await middleware.onRequest?.({
                request,
                schemaPath: "/api/atlas/v2/groups",
                params: {},
                id: "test-id",
                options: {},
            } as Parameters<NonNullable<typeof middleware.onRequest>>[0]);

            expect(result).toBeDefined();
            expect(result?.headers.get("Authorization")).toBe(`Bearer ${mockToken}`);
        });

        it("should not add Authorization header for unauth endpoints", async () => {
            const middleware = authProvider.middleware();
            const request = new Request("https://api.test.com/api/private/unauth/telemetry/events");
            const result = await middleware.onRequest?.({
                request,
                schemaPath: "/api/private/unauth/telemetry/events",
                params: {},
                id: "test-id",
                options: {},
            } as Parameters<NonNullable<typeof middleware.onRequest>>[0]);

            expect(result).toBeUndefined();
        });

        it("should not add Authorization header for oauth endpoints", async () => {
            const middleware = authProvider.middleware();
            const request = new Request("https://api.test.com/api/oauth/token");
            const result = await middleware.onRequest?.({
                request,
                schemaPath: "/api/oauth/token",
                params: {},
                id: "test-id",
                options: {},
            } as Parameters<NonNullable<typeof middleware.onRequest>>[0]);

            expect(result).toBeUndefined();
        });

        it("should return undefined when getAccessToken throws", async () => {
            vi.spyOn(authProvider, "getAccessToken").mockRejectedValue(new Error("Token error"));

            const middleware = authProvider.middleware();
            const request = new Request("https://api.test.com/api/atlas/v2/groups");
            const result = await middleware.onRequest?.({
                request,
                schemaPath: "/api/atlas/v2/groups",
                params: {},
                id: "test-id",
                options: {},
            } as Parameters<NonNullable<typeof middleware.onRequest>>[0]);

            expect(result).toBeUndefined();
        });

        it("should return request without Authorization header when token is not available", async () => {
            // @ts-expect-error accessing private property for testing
            authProvider.accessToken = undefined;
            vi.mocked(oauth.clientCredentialsGrantRequest).mockRejectedValue(new Error("Failed"));

            const middleware = authProvider.middleware();
            const request = new Request("https://api.test.com/api/atlas/v2/groups");
            const result = await middleware.onRequest?.({
                request,
                schemaPath: "/api/atlas/v2/groups",
                params: {},
                id: "test-id",
                options: {},
            } as Parameters<NonNullable<typeof middleware.onRequest>>[0]);

            // When token fetch fails, middleware returns the request without Authorization header
            expect(result).toBeDefined();
            expect(result?.headers.get("Authorization")).toBeNull();
        });
    });
});
