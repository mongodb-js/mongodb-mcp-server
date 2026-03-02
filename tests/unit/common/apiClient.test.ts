import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/common/atlas/apiClient.js";
import { packageInfo } from "../../../src/common/packageInfo.js";
import type { CommonProperties, TelemetryEvent, TelemetryResult } from "../../../src/telemetry/types.js";
import { NullLogger } from "../../../tests/utils/index.js";

describe("ApiClient", () => {
    let apiClient: ApiClient;

    const mockEvents: TelemetryEvent<CommonProperties>[] = [
        {
            timestamp: new Date().toISOString(),
            source: "mdbmcp",
            properties: {
                mcp_client_version: "1.0.0",
                mcp_client_name: "test-client",
                mcp_server_version: "1.0.0",
                mcp_server_name: "test-server",
                platform: "test-platform",
                arch: "test-arch",
                os_type: "test-os",
                component: "test-component",
                duration_ms: 100,
                result: "success" as TelemetryResult,
                category: "test-category",
            },
        },
    ];

    beforeEach(() => {
        apiClient = new ApiClient(
            {
                baseUrl: "https://api.test.com",
                credentials: {
                    clientId: "test-client-id",
                    clientSecret: "test-client-secret",
                },
                userAgent: "test-user-agent",
            },
            new NullLogger()
        );

        // @ts-expect-error accessing private property for testing
        apiClient.authProvider.validate = vi.fn().mockResolvedValue(true);
        // @ts-expect-error accessing private property for testing
        apiClient.authProvider.getAuthHeaders = vi.fn().mockResolvedValue({
            Authorization: "Bearer mockToken",
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("constructor", () => {
        it("should create a client with the correct configuration", () => {
            expect(apiClient).toBeDefined();
            expect(apiClient.isAuthConfigured()).toBeDefined();
        });
    });

    describe("User-Agent", () => {
        it("should use custom userAgent when provided in options", async () => {
            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

            await apiClient.sendEvents(mockEvents);

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const call = mockFetch.mock.calls[0];
            expect(call).toBeDefined();
            const [url, init] = call!;
            expect(url instanceof URL ? url.href : url).toBe(
                "https://api.test.com/api/private/v1.0/telemetry/events"
            );
            const headers = init?.headers as Record<string, string>;
            expect(headers).toBeDefined();
            expect(headers["User-Agent"]).toBe("test-user-agent");
        });

        it("should use default userAgent with version, platform, and arch when not provided", async () => {
            const clientWithoutUserAgent = new ApiClient(
                {
                    baseUrl: "https://api.test.com",
                    credentials: {
                        clientId: "test-client-id",
                        clientSecret: "test-client-secret",
                    },
                },
                new NullLogger()
            );
            // @ts-expect-error accessing private property for testing
            clientWithoutUserAgent.authProvider.getAuthHeaders = vi.fn().mockRejectedValue(new Error("No token"));

            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

            await clientWithoutUserAgent.sendEvents(mockEvents);

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const call = mockFetch.mock.calls[0];
            expect(call).toBeDefined();
            const [url, init] = call!;
            expect(url instanceof URL ? url.href : url).toBe(
                "https://api.test.com/api/private/unauth/telemetry/events"
            );
            const expectedDefaultUserAgent = `AtlasMCP/${packageInfo.version} (${process.platform}; ${process.arch})`;
            const headers = init?.headers as Record<string, string>;
            expect(headers).toBeDefined();
            expect(headers["User-Agent"]).toBe(expectedDefaultUserAgent);
        });

        it("should not include hostname in default userAgent", async () => {
            const clientWithoutUserAgent = new ApiClient(
                {
                    baseUrl: "https://api.test.com",
                    credentials: {
                        clientId: "test-client-id",
                        clientSecret: "test-client-secret",
                    },
                },
                new NullLogger()
            );
            // @ts-expect-error accessing private property for testing
            clientWithoutUserAgent.authProvider.getAuthHeaders = vi.fn().mockRejectedValue(new Error("No token"));

            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

            await clientWithoutUserAgent.sendEvents(mockEvents);

            const call = mockFetch.mock.calls[0];
            expect(call).toBeDefined();
            const init = call![1] as RequestInit;
            const headers = init.headers as Record<string, string>;
            const userAgent = headers["User-Agent"];
            expect(userAgent).toBeDefined();
            // Default format is AtlasMCP/version (platform; arch) — no third segment (hostname)
            expect(userAgent).toMatch(
                new RegExp(`^AtlasMCP/${packageInfo.version} \\(${process.platform}; ${process.arch}\\)$`)
            );
            expect(userAgent).not.toContain("; unknown");
            expect(userAgent).not.toMatch(/\bhostname\b/i);
        });
    });

    describe("listProjects", () => {
        it("should return a list of projects", async () => {
            const mockProjects = {
                results: [
                    { id: "1", name: "Project 1" },
                    { id: "2", name: "Project 2" },
                ],
                totalCount: 2,
            };

            const mockGet = vi.fn().mockImplementation(() => ({
                data: mockProjects,
                error: null,
                response: new Response(),
            }));

            // @ts-expect-error accessing private property for testing
            apiClient.client.GET = mockGet;

            const result = await apiClient.listGroups();

            expect(mockGet).toHaveBeenCalledWith("/api/atlas/v2/groups", undefined);
            expect(result).toEqual(mockProjects);
        });

        it("should throw an error when the API call fails", async () => {
            const mockError = {
                reason: "Test error",
                detail: "Something went wrong",
            };

            const mockGet = vi.fn().mockImplementation(() => ({
                data: null,
                error: mockError,
                response: new Response(),
            }));

            // @ts-expect-error accessing private property for testing
            apiClient.client.GET = mockGet;

            await expect(apiClient.listGroups()).rejects.toThrow();
        });
    });

    describe("sendEvents", () => {
        it("should send events to authenticated endpoint when token is available and valid", async () => {
            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

            await apiClient.sendEvents(mockEvents);

            const url = new URL("api/private/v1.0/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledWith(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer mockToken",
                    Accept: "application/json",
                    "User-Agent": "test-user-agent",
                },
                body: JSON.stringify(mockEvents),
            });
        });

        it("should fall back to unauthenticated endpoint when token is not available via exception", async () => {
            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

            // @ts-expect-error accessing private property for testing
            apiClient.authProvider.getAuthHeaders = vi.fn().mockRejectedValue(new Error("No access token available"));

            await apiClient.sendEvents(mockEvents);

            const url = new URL("api/private/unauth/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledWith(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "User-Agent": "test-user-agent",
                },
                body: JSON.stringify(mockEvents),
            });
        });

        it("should fall back to unauthenticated endpoint when token is undefined", async () => {
            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

            // @ts-expect-error accessing private property for testing
            apiClient.authProvider.getAuthHeaders = vi.fn().mockResolvedValue(undefined);

            await apiClient.sendEvents(mockEvents);

            const url = new URL("api/private/unauth/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledWith(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "User-Agent": "test-user-agent",
                },
                body: JSON.stringify(mockEvents),
            });
        });

        it("should fall back to unauthenticated endpoint on 401 error", async () => {
            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch
                .mockResolvedValueOnce(new Response(null, { status: 401 }))
                .mockResolvedValueOnce(new Response(null, { status: 200 }));

            await apiClient.sendEvents(mockEvents);

            const url = new URL("api/private/unauth/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockFetch).toHaveBeenLastCalledWith(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "User-Agent": "test-user-agent",
                },
                body: JSON.stringify(mockEvents),
            });
        });

        it("should throw error when both authenticated and unauthenticated requests fail", async () => {
            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch
                .mockResolvedValueOnce(new Response(null, { status: 401 }))
                .mockResolvedValueOnce(new Response(null, { status: 500 }));

            const mockToken = "test-token";
            // @ts-expect-error accessing private property for testing
            apiClient.authProvider.getAuthHeaders = vi.fn().mockResolvedValue({
                Authorization: `Bearer ${mockToken}`,
            });

            await expect(apiClient.sendEvents(mockEvents)).rejects.toThrow();
        });
    });
});
