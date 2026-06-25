import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, requestIdAttr } from "../../../src/common/atlas/apiClient.js";
import { packageInfo } from "../../../src/common/packageInfo.js";
import type { CommonProperties, TelemetryEvent, TelemetryResult } from "../../../src/telemetry/types.js";
import { NullLogger } from "../../../src/common/logging/index.js";

describe("requestIdAttr", () => {
    it("returns the x-request-id when present as a string header", () => {
        expect(requestIdAttr({ requestInfo: { headers: { "x-request-id": "req-123" } } })).toEqual({
            "x-request-id": "req-123",
        });
    });

    it("returns empty object when context is undefined", () => {
        expect(requestIdAttr(undefined)).toEqual({});
    });

    it("returns empty object when requestInfo is absent", () => {
        expect(requestIdAttr({})).toEqual({});
    });

    it("returns empty object when x-request-id header is missing", () => {
        expect(requestIdAttr({ requestInfo: { headers: {} } })).toEqual({});
    });

    it("returns empty object when x-request-id header is not a string", () => {
        expect(requestIdAttr({ requestInfo: { headers: { "x-request-id": ["a", "b"] } } })).toEqual({});
    });
});

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
            expect(url instanceof URL ? url.href : url).toBe("https://api.test.com/api/private/v1.0/telemetry/events");
            const headers = init?.headers as Record<string, string>;
            expect(headers).toBeDefined();
            expect(headers["User-Agent"]).toBe("test-user-agent");
            expect(init?.signal).toBeInstanceOf(AbortSignal);
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

    describe("request header forwarding", () => {
        const okResponse = { data: { results: [], totalCount: 0 }, error: null, response: new Response() };

        it("forwards context.requestInfo.headers to the underlying client when no options are provided", async () => {
            const mockGet = vi.fn().mockReturnValue(okResponse);
            // @ts-expect-error accessing private property for testing
            apiClient.client.GET = mockGet;

            await apiClient.listGroups(undefined, { requestInfo: { headers: { "x-request-id": "req-123" } } });

            expect(mockGet).toHaveBeenCalledWith("/api/atlas/v2/groups", {
                headers: { "x-request-id": "req-123" },
            });
        });

        it("merges allowlisted context headers with existing option headers, letting option headers win", async () => {
            const mockGet = vi.fn().mockReturnValue(okResponse);
            // @ts-expect-error accessing private property for testing
            apiClient.client.GET = mockGet;

            await apiClient.listGroups(
                {
                    params: { query: { itemsPerPage: 10 } },
                    headers: { "x-request-id": "from-options", Accept: "application/json" },
                } as never,
                { requestInfo: { headers: { "x-request-id": "from-context" } } }
            );

            expect(mockGet).toHaveBeenCalledWith("/api/atlas/v2/groups", {
                params: { query: { itemsPerPage: 10 } },
                headers: {
                    // the explicit option header wins over the context value on conflict
                    "x-request-id": "from-options",
                    Accept: "application/json",
                },
            });
        });

        it("only forwards allowlisted string headers and drops everything else", async () => {
            const mockGet = vi.fn().mockReturnValue(okResponse);
            // @ts-expect-error accessing private property for testing
            apiClient.client.GET = mockGet;

            await apiClient.listGroups(undefined, {
                requestInfo: {
                    headers: {
                        "x-request-id": "req-123",
                        // non-allowlisted headers must not be propagated
                        host: "internal.example.com",
                        "content-length": "42",
                        cookie: "session=secret",
                        authorization: "Bearer leaked",
                        // non-string values must be ignored even if the name were allowlisted
                        "x-request-id-extra": ["a", "b"],
                    },
                },
            });

            expect(mockGet).toHaveBeenCalledWith("/api/atlas/v2/groups", {
                headers: { "x-request-id": "req-123" },
            });
        });

        it("matches allowlisted header names case-insensitively", async () => {
            const mockGet = vi.fn().mockReturnValue(okResponse);
            // @ts-expect-error accessing private property for testing
            apiClient.client.GET = mockGet;

            await apiClient.listGroups(undefined, { requestInfo: { headers: { "X-Request-Id": "req-Case" } } });

            expect(mockGet).toHaveBeenCalledWith("/api/atlas/v2/groups", {
                headers: { "X-Request-Id": "req-Case" },
            });
        });

        it("passes options through unchanged when no context is provided", async () => {
            const mockGet = vi.fn().mockReturnValue(okResponse);
            // @ts-expect-error accessing private property for testing
            apiClient.client.GET = mockGet;

            await apiClient.listGroups();

            expect(mockGet).toHaveBeenCalledWith("/api/atlas/v2/groups", undefined);
        });

        it("does not add headers when the context carries no headers", async () => {
            const mockGet = vi.fn().mockReturnValue(okResponse);
            // @ts-expect-error accessing private property for testing
            apiClient.client.GET = mockGet;

            const options = { params: { query: { itemsPerPage: 5 } } } as never;
            await apiClient.listGroups(options, { requestInfo: {} });

            expect(mockGet).toHaveBeenCalledWith("/api/atlas/v2/groups", options);
        });

        it("forwards context headers on POST (create) requests", async () => {
            const mockPost = vi.fn().mockReturnValue({ data: { id: "1" }, error: null, response: new Response() });
            // @ts-expect-error accessing private property for testing
            apiClient.client.POST = mockPost;

            await apiClient.createGroup({ body: { name: "proj" } } as never, {
                requestInfo: { headers: { "x-request-id": "req-xyz" } },
            });

            expect(mockPost).toHaveBeenCalledWith("/api/atlas/v2/groups", {
                body: { name: "proj" },
                headers: { "x-request-id": "req-xyz" },
            });
        });
    });

    describe("sendEvents", () => {
        it("should send events to authenticated endpoint when token is available and valid", async () => {
            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

            await apiClient.sendEvents(mockEvents);

            const url = new URL("api/private/v1.0/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledWith(
                url,
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: "Bearer mockToken",
                        Accept: "application/json",
                        "User-Agent": "test-user-agent",
                    },
                    body: JSON.stringify(mockEvents),
                })
            );
        });

        it("should fall back to unauthenticated endpoint when token is not available via exception", async () => {
            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

            // @ts-expect-error accessing private property for testing
            apiClient.authProvider.getAuthHeaders = vi.fn().mockRejectedValue(new Error("No access token available"));

            await apiClient.sendEvents(mockEvents);

            const url = new URL("api/private/unauth/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledWith(
                url,
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        "User-Agent": "test-user-agent",
                    },
                    body: JSON.stringify(mockEvents),
                })
            );
        });

        it("should fall back to unauthenticated endpoint when token is undefined", async () => {
            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

            // @ts-expect-error accessing private property for testing
            apiClient.authProvider.getAuthHeaders = vi.fn().mockResolvedValue(undefined);

            await apiClient.sendEvents(mockEvents);

            const url = new URL("api/private/unauth/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledWith(
                url,
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        "User-Agent": "test-user-agent",
                    },
                    body: JSON.stringify(mockEvents),
                })
            );
        });

        it("should fall back to unauthenticated endpoint on 401 error", async () => {
            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch
                .mockResolvedValueOnce(new Response(null, { status: 401 }))
                .mockResolvedValueOnce(new Response(null, { status: 200 }));

            await apiClient.sendEvents(mockEvents);

            const url = new URL("api/private/unauth/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockFetch).toHaveBeenLastCalledWith(
                url,
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        "User-Agent": "test-user-agent",
                    },
                    body: JSON.stringify(mockEvents),
                })
            );
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

    describe("upgradeTenantUpgrade", () => {
        // upgradeTenantUpgrade: upgrades Free (M0/shared) clusters to Flex or Dedicated (M10+)
        const upgradeOptions = {
            params: { path: { groupId: "test-group-id" } },
            body: { name: "MyCluster", providerSettings: { providerName: "FLEX", instanceSizeName: "FLEX" } },
        } as unknown as Parameters<ApiClient["upgradeTenantUpgrade"]>[0];

        it("should POST to the tenant upgrade endpoint", async () => {
            const mockResult = { id: "upgraded-cluster-id", name: "MyCluster" };
            const mockPost = vi.fn().mockResolvedValue({ data: mockResult, error: null, response: new Response() });
            // @ts-expect-error accessing private property for testing
            apiClient.client.POST = mockPost;

            const result = await apiClient.upgradeTenantUpgrade(upgradeOptions);

            expect(mockPost).toHaveBeenCalledWith(
                "/api/atlas/v2/groups/{groupId}/clusters/tenantUpgrade",
                expect.anything()
            );
            const [, options] = mockPost.mock.calls[0] as [string, { headers: Record<string, string> }];
            expect(options.headers["Accept"]).toBe("application/vnd.atlas.2023-01-01+json");
            expect(result).toEqual(mockResult);
        });

        it("should throw when the API call fails", async () => {
            const mockPost = vi.fn().mockResolvedValue({
                data: null,
                error: { reason: "Bad Request" },
                response: new Response(),
            });
            // @ts-expect-error accessing private property for testing
            apiClient.client.POST = mockPost;

            await expect(apiClient.upgradeTenantUpgrade(upgradeOptions)).rejects.toThrow();
        });
    });

    describe("tenantUpgrade", () => {
        // tenantUpgrade: upgrades Flex clusters to Dedicated (M10+)
        const upgradeOptions = {
            params: { path: { groupId: "test-group-id" } },
            body: { name: "MyCluster", clusterType: "REPLICASET", replicationSpecs: [] },
        } as unknown as Parameters<ApiClient["tenantUpgrade"]>[0];

        it("should POST to the flex tenant upgrade endpoint", async () => {
            const mockResult = { id: "upgraded-cluster-id", name: "MyCluster" };
            const mockPost = vi.fn().mockResolvedValue({ data: mockResult, error: null, response: new Response() });
            // @ts-expect-error accessing private property for testing
            apiClient.client.POST = mockPost;

            const result = await apiClient.tenantUpgrade(upgradeOptions);

            expect(mockPost).toHaveBeenCalledWith(
                "/api/atlas/v2/groups/{groupId}/flexClusters:tenantUpgrade",
                upgradeOptions
            );
            expect(result).toEqual(mockResult);
        });

        it("should throw when the API call fails", async () => {
            const mockPost = vi.fn().mockResolvedValue({
                data: null,
                error: { reason: "Bad Request" },
                response: new Response(),
            });
            // @ts-expect-error accessing private property for testing
            apiClient.client.POST = mockPost;

            await expect(apiClient.tenantUpgrade(upgradeOptions)).rejects.toThrow();
        });
    });
});
