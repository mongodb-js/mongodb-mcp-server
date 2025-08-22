import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../../src/common/atlas/apiClient.js";
import type { CommonProperties, TelemetryEvent, TelemetryResult } from "../../../src/telemetry/types.js";
import { NullLogger } from "../../../src/common/logger.js";

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
        apiClient.getAccessToken = vi.fn().mockResolvedValue("mockToken");
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("constructor", () => {
        it("should create a client with the correct configuration", () => {
            expect(apiClient).toBeDefined();
            expect(apiClient.hasCredentials()).toBeDefined();
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

            const result = await apiClient.listProjects();

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

            await expect(apiClient.listProjects()).rejects.toThrow();
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
            apiClient.getAccessToken = vi.fn().mockRejectedValue(new Error("No access token available"));

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
            apiClient.getAccessToken = vi.fn().mockReturnValueOnce(undefined);

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
            apiClient.getAccessToken = vi.fn().mockResolvedValue(mockToken);

            await expect(apiClient.sendEvents(mockEvents)).rejects.toThrow();
        });
    });
});
