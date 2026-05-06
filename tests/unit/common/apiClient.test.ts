import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { packageInfo } from "../../../src/common/packageInfo.js";
import type {
    TelemetryCommonProperties as CommonProperties,
    TelemetryEvent,
    TelemetryResult,
} from "@mongodb-js/mcp-atlas-telemetry";
import { NoopLogger } from "@mongodb-js/mcp-core";

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
        apiClient = new ApiClient({
            baseUrl: "https://api.test.com",
            credentials: {
                clientId: "test-client-id",
                clientSecret: "test-client-secret",
            },
            userAgent: "test-user-agent",
            logger: new NoopLogger(),
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
        it("should use custom userAgent when provided in options", async () => {
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
            expect(headers["User-Agent"]).toBe("test-user-agent");
            expect(init?.signal).toBeInstanceOf(AbortSignal);
        });

        it("should use the provided userAgent in unauth requests", async () => {
            const expectedUserAgent = `AtlasMCP/${packageInfo.version} (${process.platform}; ${process.arch})`;
            const clientWithUserAgent = new ApiClient({
                baseUrl: "https://api.test.com",
                credentials: {
                    clientId: "test-client-id",
                    clientSecret: "test-client-secret",
                },
                userAgent: expectedUserAgent,
                logger: new NoopLogger(),
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
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- mocking openapi-fetch client
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
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- mocking openapi-fetch client
            apiClient.client.GET = mockGet;

            await expect(apiClient.listGroups()).rejects.toThrow();
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

            await apiClient.sendEvents({ events: mockEvents });

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

            await apiClient.sendEvents({ events: mockEvents });

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
                        "User-Agent": "test-user-agent",
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
                        "User-Agent": "test-user-agent",
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
