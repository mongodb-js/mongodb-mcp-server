import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ClientCredentialsAuthProvider } from "@mongodb-js/mcp-atlas-api-client";
import type { TelemetryEvent } from "@mongodb-js/mcp-types";
import { NoopLogger } from "@mongodb-js/mcp-core";
import { userAgentFromServerMetadata } from "./userAgentFromServerMetadata.js";

/** Subset of atlas telemetry common properties used in ApiClient tests */
type MockTelemetryCommonProperties = {
    mcp_client_version: string;
    mcp_client_name: string;
    mcp_server_version: string;
    mcp_server_name: string;
    platform: string;
    arch: string;
    os_type: string;
};

const testServerMetadata = { mcpServerName: "test-user-agent", version: "1.0.0" };
const TEST_USER_AGENT = userAgentFromServerMetadata(testServerMetadata);

describe("ApiClient", () => {
    let apiClient: ApiClient;

    const mockEvents: TelemetryEvent<MockTelemetryCommonProperties>[] = [
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
                result: "success",
                category: "test-category",
            },
        },
    ];

    beforeEach(() => {
        apiClient = new ApiClient({
            options: {
                baseUrl: "https://api.test.com",
            },
            serverMetadata: testServerMetadata,
            logger: new NoopLogger(),
            authProvider: new ClientCredentialsAuthProvider({
                options: {
                    baseUrl: "https://api.test.com",
                    clientId: "test-client-id",
                    clientSecret: "test-client-secret",
                },
                serverMetadata: testServerMetadata,
                logger: new NoopLogger(),
            }),
        });

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
        it("should derive userAgent from serverMetadata", async () => {
            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

            await apiClient.sendEvents({ events: mockEvents });

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const call = mockFetch.mock.calls[0];
            expect(call).toBeDefined();
            const [url, init] = call!;
            expect(url instanceof URL ? url.href : url).toBe("https://api.test.com/api/private/v1.0/telemetry/events");
            const headers = init?.headers as Record<string, string>;
            expect(headers).toBeDefined();
            expect(headers["User-Agent"]).toBe(TEST_USER_AGENT);
            expect(init?.signal).toBeInstanceOf(AbortSignal);
        });

        it("should use serverMetadata-derived userAgent in unauth requests", async () => {
            const serverMetadata = { mcpServerName: "AtlasMCP", version: "1.0.0-test" };
            const expectedUserAgent = userAgentFromServerMetadata(serverMetadata);
            const clientWithUserAgent = new ApiClient({
                options: {
                    baseUrl: "https://api.test.com",
                },
                serverMetadata,
                logger: new NoopLogger(),
                authProvider: new ClientCredentialsAuthProvider({
                    options: {
                        baseUrl: "https://api.test.com",
                        clientId: "test-client-id",
                        clientSecret: "test-client-secret",
                    },
                    serverMetadata,
                    logger: new NoopLogger(),
                }),
            });
            // @ts-expect-error accessing private property for testing
            clientWithUserAgent.authProvider.getAuthHeaders = vi.fn().mockRejectedValue(new Error("No token"));

            const mockFetch = vi.spyOn(global, "fetch");
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

            await clientWithUserAgent.sendEvents({ events: mockEvents });

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const call = mockFetch.mock.calls[0];
            expect(call).toBeDefined();
            const [url, init] = call!;
            expect(url instanceof URL ? url.href : url).toBe(
                "https://api.test.com/api/private/unauth/telemetry/events"
            );
            const headers = init?.headers as Record<string, string>;
            expect(headers).toBeDefined();
            expect(headers["User-Agent"]).toBe(expectedUserAgent);
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

            await apiClient.sendEvents({ events: mockEvents });

            const url = new URL("api/private/v1.0/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledWith(
                url,
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: "Bearer mockToken",
                        Accept: "application/json",
                        "User-Agent": TEST_USER_AGENT,
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

            await apiClient.sendEvents({ events: mockEvents });

            const url = new URL("api/private/unauth/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledWith(
                url,
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        "User-Agent": TEST_USER_AGENT,
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

            await apiClient.sendEvents({ events: mockEvents });

            const url = new URL("api/private/unauth/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledWith(
                url,
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        "User-Agent": TEST_USER_AGENT,
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

            await apiClient.sendEvents({ events: mockEvents });

            const url = new URL("api/private/unauth/telemetry/events", "https://api.test.com");
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockFetch).toHaveBeenLastCalledWith(
                url,
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        "User-Agent": TEST_USER_AGENT,
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

            await expect(apiClient.sendEvents({ events: mockEvents })).rejects.toThrow();
        });
    });

    describe("upgradeSharedTierCluster", () => {
        const upgradeOptions = {
            groupId: "test-group-id",
            body: {
                name: "MyCluster",
                providerSettings: {
                    providerName: "FLEX",
                    instanceSizeName: "FLEX" as const,
                    backingProviderName: "AWS",
                    regionName: "US_EAST_1",
                },
            },
        };

        it("should POST to the tenant upgrade endpoint with legacy API version headers", async () => {
            const mockCustomFetch = vi
                .spyOn(apiClient as unknown as { customFetch: typeof fetch }, "customFetch")
                .mockResolvedValue(new Response(JSON.stringify({ id: "upgraded-cluster-id" }), { status: 200 }));

            const result = await apiClient.upgradeSharedTierCluster(upgradeOptions);

            expect(mockCustomFetch).toHaveBeenCalledWith(
                "https://api.test.com/api/atlas/v2/groups/test-group-id/clusters/tenantUpgrade",
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/vnd.atlas.2023-01-01+json",
                        Accept: "application/vnd.atlas.2023-01-01+json",
                        Authorization: "Bearer mockToken",
                        "User-Agent": TEST_USER_AGENT,
                    },
                    body: JSON.stringify(upgradeOptions.body),
                })
            );
            expect(result).toEqual({ id: "upgraded-cluster-id" });
        });

        it("should throw when the response is not ok", async () => {
            vi.spyOn(apiClient as unknown as { customFetch: typeof fetch }, "customFetch").mockResolvedValue(
                new Response(JSON.stringify({ error: "Bad Request" }), { status: 400 })
            );

            await expect(apiClient.upgradeSharedTierCluster(upgradeOptions)).rejects.toThrow();
        });
    });

    describe("upgradeFlexToDedicated", () => {
        const upgradeOptions = {
            groupId: "test-group-id",
            body: {
                name: "MyCluster",
                clusterType: "REPLICASET" as const,
                replicationSpecs: [
                    {
                        regionConfigs: [
                            {
                                providerName: "AWS",
                                regionName: "US_EAST_1",
                                priority: 7,
                                electableSpecs: { instanceSize: "M10", nodeCount: 3 },
                            },
                        ],
                    },
                ],
                autoScaling: {
                    compute: { enabled: true, scaleDownEnabled: true, minInstanceSize: "M10", maxInstanceSize: "M30" },
                    diskGBEnabled: true,
                },
            },
        };

        it("should POST to the flex tenant upgrade endpoint with current API version headers", async () => {
            const mockCustomFetch = vi
                .spyOn(apiClient as unknown as { customFetch: typeof fetch }, "customFetch")
                .mockResolvedValue(new Response(JSON.stringify({ id: "upgraded-cluster-id" }), { status: 200 }));

            const result = await apiClient.upgradeFlexToDedicated(upgradeOptions);

            expect(mockCustomFetch).toHaveBeenCalledWith(
                "https://api.test.com/api/atlas/v2/groups/test-group-id/flexClusters:tenantUpgrade",
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/vnd.atlas.2025-03-12+json",
                        Accept: "application/vnd.atlas.2025-03-12+json",
                        Authorization: "Bearer mockToken",
                        "User-Agent": TEST_USER_AGENT,
                    },
                    body: JSON.stringify(upgradeOptions.body),
                })
            );
            expect(result).toEqual({ id: "upgraded-cluster-id" });
        });

        it("should throw when the response is not ok", async () => {
            vi.spyOn(apiClient as unknown as { customFetch: typeof fetch }, "customFetch").mockResolvedValue(
                new Response(JSON.stringify({ error: "Bad Request" }), { status: 400 })
            );

            await expect(apiClient.upgradeFlexToDedicated(upgradeOptions)).rejects.toThrow();
        });
    });
});
