import createClient from "openapi-fetch";
import type { ClientOptions, FetchOptions, Client, Middleware } from "openapi-fetch";
import { ApiClientError } from "./apiClientError.js";
import type { components, paths, operations } from "./openapi.js";
import type { LoggerBase } from "@mongodb-js/mcp-core";
import type { IApiClient } from "@mongodb-js/mcp-types";
import { createFetch } from "@mongodb-js/devtools-proxy-support";
import { Request as NodeFetchRequest } from "node-fetch";
import type { Credentials, AuthProvider } from "./auth/authProvider.js";
import { AuthProviderFactory } from "./auth/authProvider.js";

const ATLAS_API_VERSION = "2025-03-12";
const DEFAULT_SEND_TIMEOUT_MS = 5_000;

/**
 * Detects whether we're running on Node.js as opposed to a browser/web
 * environment. We rely on `process.versions.node` rather than `typeof process`
 * because bundlers (e.g. Vite) may replace `process` with a literal object
 * shim in the browser build, which would still be `"object"` at runtime.
 */
function isNodeRuntime(): boolean {
    return typeof process !== "undefined" && process.versions !== undefined && process.versions.node !== undefined;
}

export interface ApiClientOptions {
    baseUrl: string;
    userAgent: string;
    credentials?: Credentials;
    requestContext?: RequestContext;
    logger: LoggerBase;
    authProvider?: AuthProvider;
}

export type RequestContext = {
    headers?: Record<string, string | string[] | undefined>;
};

export class ApiClient implements IApiClient {
    private readonly options: {
        baseUrl: string;
        userAgent: string;
    };

    private customFetch: typeof fetch;

    private client: Client<paths>;

    public isAuthConfigured(): boolean {
        return !!this.authProvider;
    }

    readonly logger: LoggerBase;
    readonly authProvider?: AuthProvider;

    constructor(options: ApiClientOptions) {
        this.logger = options.logger;
        // In Node we use `createFetch` from devtools-proxy-support to pick up
        // environment-variable proxy configuration and system CA trust, and we
        // use node-fetch's Request since its interface is a superset of the
        // web Request. In the browser those Node-only concerns don't apply and
        // the implementations aren't available, so we fall back to the native
        // `fetch`/`Request` globals.
        if (isNodeRuntime()) {
            // createFetch assumes that the first parameter of fetch is always a string
            // with the URL. However, fetch can also receive a Request object. While
            // the typechecking complains, createFetch does passthrough the parameters
            // so it works fine. That said, node-fetch has incompatibilities with the web version
            // of fetch and can lead to genuine issues so we would like to move away of node-fetch dependency.
            this.customFetch = createFetch({
                useEnvironmentVariableProxies: true,
            }) as unknown as typeof fetch;
        } else {
            this.customFetch = globalThis.fetch.bind(globalThis);
        }
        this.options = {
            baseUrl: options.baseUrl,
            userAgent: options.userAgent,
        };

        this.authProvider =
            options.authProvider ??
            AuthProviderFactory.create(
                {
                    apiBaseUrl: this.options.baseUrl,
                    userAgent: this.options.userAgent,
                    credentials: options.credentials ?? {},
                },
                this.logger
            );

        this.client = createClient<paths>({
            baseUrl: this.options.baseUrl,
            headers: {
                "User-Agent": this.options.userAgent,
                Accept: `application/vnd.atlas.${ATLAS_API_VERSION}+json`,
            },
            fetch: this.customFetch,
            // NodeFetchRequest has more overloadings than the native Request
            // so it complains here. However, the interfaces are actually compatible
            // so it's not a real problem, just a type checking problem.
            Request: (isNodeRuntime() ? NodeFetchRequest : globalThis.Request) as unknown as ClientOptions["Request"],
        });

        if (this.authProvider) {
            this.client.use(this.createAuthMiddleware());
        }
    }

    private createAuthMiddleware(): Middleware {
        return {
            onRequest: async ({ request, schemaPath }): Promise<Request | undefined> => {
                if (schemaPath.startsWith("/api/private/unauth") || schemaPath.startsWith("/api/oauth")) {
                    return undefined;
                }

                try {
                    const authHeaders = (await this.authProvider?.getAuthHeaders()) ?? {};
                    for (const [key, value] of Object.entries(authHeaders)) {
                        request.headers.set(key, value);
                    }
                    return request;
                } catch {
                    // ignore not available tokens, API will return 401
                    return undefined;
                }
            },
        };
    }

    public async validateAuthConfig(): Promise<void> {
        await this.authProvider?.validate();
    }

    public async close(): Promise<void> {
        await this.authProvider?.revoke();
    }

    public async getIpInfo(): Promise<{
        currentIpv4Address: string;
    }> {
        const authHeaders = (await this.authProvider?.getAuthHeaders()) ?? {};

        const endpoint = "api/private/ipinfo";
        const url = new URL(endpoint, this.options.baseUrl);
        const response = await fetch(url, {
            method: "GET",
            headers: {
                ...authHeaders,
                Accept: "application/json",
                "User-Agent": this.options.userAgent,
            },
        });

        if (!response.ok) {
            throw await ApiClientError.fromResponse(response);
        }

        return (await response.json()) as Promise<{
            currentIpv4Address: string;
        }>;
    }

    public async sendEvents(options: { events: unknown[]; signal?: AbortSignal } = { events: [] }): Promise<void> {
        const { events, signal = AbortSignal.timeout(DEFAULT_SEND_TIMEOUT_MS) } = options;
        if (!this.authProvider) {
            await this.sendUnauthEvents(events, signal);
            return;
        }

        try {
            await this.sendAuthEvents(events, signal);
        } catch (error) {
            if (error instanceof ApiClientError) {
                if (error.response.status !== 401) {
                    throw error;
                }
            }

            await this.sendUnauthEvents(events, signal);
        }
    }

    private async sendAuthEvents(events: unknown[], signal?: AbortSignal): Promise<void> {
        const authHeaders = await this.authProvider?.getAuthHeaders();
        if (!authHeaders) {
            throw new Error("No access token available");
        }
        const authUrl = new URL("api/private/v1.0/telemetry/events", this.options.baseUrl);
        const response = await fetch(authUrl, {
            method: "POST",
            headers: {
                ...authHeaders,
                Accept: "application/json",
                "Content-Type": "application/json",
                "User-Agent": this.options.userAgent,
            },
            body: JSON.stringify(events),
            signal,
        });

        if (!response.ok) {
            throw await ApiClientError.fromResponse(response);
        }
    }

    private async sendUnauthEvents(events: unknown[], signal?: AbortSignal): Promise<void> {
        const headers: Record<string, string> = {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": this.options.userAgent,
        };

        const unauthUrl = new URL("api/private/unauth/telemetry/events", this.options.baseUrl);
        const response = await fetch(unauthUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(events),
            signal,
        });

        if (!response.ok) {
            throw await ApiClientError.fromResponse(response);
        }
    }

    // DO NOT EDIT. This is auto-generated code.
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    async listClusterDetails(
        options?: FetchOptions<operations["listClusterDetails"]>
    ): Promise<components["schemas"]["PaginatedOrgGroupView"]> {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/clusters", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listGroups(
        options?: FetchOptions<operations["listGroups"]>
    ): Promise<components["schemas"]["PaginatedAtlasGroupView"]> {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async createGroup(options: FetchOptions<operations["createGroup"]>): Promise<components["schemas"]["Group"]> {
        const { data, error, response } = await this.client.POST("/api/atlas/v2/groups", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteGroup(options: FetchOptions<operations["deleteGroup"]>) {
        const { error, response } = await this.client.DELETE("/api/atlas/v2/groups/{groupId}", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    async getGroup(options: FetchOptions<operations["getGroup"]>): Promise<components["schemas"]["Group"]> {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups/{groupId}", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listAccessListEntries(
        options: FetchOptions<operations["listGroupAccessListEntries"]>
    ): Promise<components["schemas"]["PaginatedNetworkAccessView"]> {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups/{groupId}/accessList", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async createAccessListEntry(
        options: FetchOptions<operations["createGroupAccessListEntry"]>
    ): Promise<components["schemas"]["PaginatedNetworkAccessView"]> {
        const { data, error, response } = await this.client.POST("/api/atlas/v2/groups/{groupId}/accessList", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteAccessListEntry(options: FetchOptions<operations["deleteGroupAccessListEntry"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/accessList/{entryValue}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    async listAlerts(
        options: FetchOptions<operations["listGroupAlerts"]>
    ): Promise<components["schemas"]["PaginatedAlertView"]> {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups/{groupId}/alerts", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listClusters(
        options: FetchOptions<operations["listGroupClusters"]>
    ): Promise<components["schemas"]["PaginatedClusterDescription20240805"]> {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups/{groupId}/clusters", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async createCluster(
        options: FetchOptions<operations["createGroupCluster"]>
    ): Promise<components["schemas"]["ClusterDescription20240805"]> {
        const { data, error, response } = await this.client.POST("/api/atlas/v2/groups/{groupId}/clusters", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteCluster(options: FetchOptions<operations["deleteGroupCluster"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/clusters/{clusterName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    async getCluster(
        options: FetchOptions<operations["getGroupCluster"]>
    ): Promise<components["schemas"]["ClusterDescription20240805"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/clusters/{clusterName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listDropIndexSuggestions(
        options: FetchOptions<operations["listGroupClusterPerformanceAdvisorDropIndexSuggestions"]>
    ): Promise<components["schemas"]["DropIndexSuggestionsResponse"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/clusters/{clusterName}/performanceAdvisor/dropIndexSuggestions",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listSchemaAdvice(
        options: FetchOptions<operations["listGroupClusterPerformanceAdvisorSchemaAdvice"]>
    ): Promise<components["schemas"]["SchemaAdvisorResponse"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/clusters/{clusterName}/performanceAdvisor/schemaAdvice",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listClusterSuggestedIndexes(
        options: FetchOptions<operations["listGroupClusterPerformanceAdvisorSuggestedIndexes"]>
    ): Promise<components["schemas"]["PerformanceAdvisorResponse"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/clusters/{clusterName}/performanceAdvisor/suggestedIndexes",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listDatabaseUsers(
        options: FetchOptions<operations["listGroupDatabaseUsers"]>
    ): Promise<components["schemas"]["PaginatedApiAtlasDatabaseUserView"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/databaseUsers",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async createDatabaseUser(
        options: FetchOptions<operations["createGroupDatabaseUser"]>
    ): Promise<components["schemas"]["CloudDatabaseUser"]> {
        const { data, error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/databaseUsers",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteDatabaseUser(options: FetchOptions<operations["deleteGroupDatabaseUser"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/databaseUsers/{databaseName}/{username}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    async listFlexClusters(
        options: FetchOptions<operations["listGroupFlexClusters"]>
    ): Promise<components["schemas"]["PaginatedFlexClusters20241113"]> {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups/{groupId}/flexClusters", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async createFlexCluster(
        options: FetchOptions<operations["createGroupFlexCluster"]>
    ): Promise<components["schemas"]["FlexClusterDescription20241113"]> {
        const { data, error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/flexClusters",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteFlexCluster(options: FetchOptions<operations["deleteGroupFlexCluster"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/flexClusters/{name}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    async getFlexCluster(
        options: FetchOptions<operations["getGroupFlexCluster"]>
    ): Promise<components["schemas"]["FlexClusterDescription20241113"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/flexClusters/{name}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listSlowQueryLogs(
        options: FetchOptions<operations["listGroupProcessPerformanceAdvisorSlowQueryLogs"]>
    ): Promise<components["schemas"]["PerformanceAdvisorSlowQueryList"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/processes/{processId}/performanceAdvisor/slowQueryLogs",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listStreamWorkspaces(
        options: FetchOptions<operations["listGroupStreamWorkspaces"]>
    ): Promise<components["schemas"]["PaginatedApiStreamsTenantView"]> {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups/{groupId}/streams", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async createStreamWorkspace(
        options: FetchOptions<operations["createGroupStreamWorkspace"]>
    ): Promise<components["schemas"]["StreamsTenant"]> {
        const { data, error, response } = await this.client.POST("/api/atlas/v2/groups/{groupId}/streams", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async getAccountDetails(
        options: FetchOptions<operations["getGroupStreamAccountDetails"]>
    ): Promise<components["schemas"]["AccountDetails"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/streams/accountDetails",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listPrivateLinkConnections(
        options: FetchOptions<operations["listGroupStreamPrivateLinkConnections"]>
    ): Promise<components["schemas"]["PaginatedApiStreamsPrivateLinkView"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/streams/privateLinkConnections",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async createPrivateLinkConnection(
        options: FetchOptions<operations["createGroupStreamPrivateLinkConnection"]>
    ): Promise<components["schemas"]["StreamsPrivateLinkConnection"]> {
        const { data, error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/streams/privateLinkConnections",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deletePrivateLinkConnection(options: FetchOptions<operations["deleteGroupStreamPrivateLinkConnection"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/streams/privateLinkConnections/{connectionId}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    async getPrivateLinkConnection(
        options: FetchOptions<operations["getGroupStreamPrivateLinkConnection"]>
    ): Promise<components["schemas"]["StreamsPrivateLinkConnection"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/streams/privateLinkConnections/{connectionId}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteVpcPeeringConnection(options: FetchOptions<operations["deleteGroupStreamVpcPeeringConnection"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/streams/vpcPeeringConnections/{id}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async acceptVpcPeeringConnection(options: FetchOptions<operations["acceptGroupStreamVpcPeeringConnection"]>) {
        const { error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/streams/vpcPeeringConnections/{id}:accept",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async rejectVpcPeeringConnection(options: FetchOptions<operations["rejectGroupStreamVpcPeeringConnection"]>) {
        const { error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/streams/vpcPeeringConnections/{id}:reject",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteStreamWorkspace(options: FetchOptions<operations["deleteGroupStreamWorkspace"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    async getStreamWorkspace(
        options: FetchOptions<operations["getGroupStreamWorkspace"]>
    ): Promise<components["schemas"]["StreamsTenant"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async updateStreamWorkspace(
        options: FetchOptions<operations["updateGroupStreamWorkspace"]>
    ): Promise<components["schemas"]["StreamsTenant"]> {
        const { data, error, response } = await this.client.PATCH(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async downloadAuditLogs(options: FetchOptions<operations["downloadGroupStreamAuditLogs"]>) {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/auditLogs",
            { ...options, headers: { Accept: "application/vnd.atlas.2023-02-01+gzip", ...options?.headers } }
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listStreamConnections(
        options: FetchOptions<operations["listGroupStreamConnections"]>
    ): Promise<components["schemas"]["PaginatedApiStreamsConnectionView"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/connections",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async createStreamConnection(
        options: FetchOptions<operations["createGroupStreamConnection"]>
    ): Promise<components["schemas"]["StreamsConnection"]> {
        const { data, error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/connections",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteStreamConnection(options: FetchOptions<operations["deleteGroupStreamConnection"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/connections/{connectionName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    async getStreamConnection(
        options: FetchOptions<operations["getGroupStreamConnection"]>
    ): Promise<components["schemas"]["StreamsConnection"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/connections/{connectionName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async updateStreamConnection(
        options: FetchOptions<operations["updateGroupStreamConnection"]>
    ): Promise<components["schemas"]["StreamsConnection"]> {
        const { data, error, response } = await this.client.PATCH(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/connections/{connectionName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async createStreamProcessor(
        options: FetchOptions<operations["createGroupStreamProcessor"]>
    ): Promise<components["schemas"]["StreamsProcessor"]> {
        const { data, error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/processor",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteStreamProcessor(options: FetchOptions<operations["deleteGroupStreamProcessor"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/processor/{processorName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    async getStreamProcessor(
        options: FetchOptions<operations["getGroupStreamProcessor"]>
    ): Promise<components["schemas"]["StreamsProcessorWithStats"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/processor/{processorName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async updateStreamProcessor(
        options: FetchOptions<operations["updateGroupStreamProcessor"]>
    ): Promise<components["schemas"]["StreamsProcessorWithStats"]> {
        const { data, error, response } = await this.client.PATCH(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/processor/{processorName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async startStreamProcessor(options: FetchOptions<operations["startGroupStreamProcessor"]>) {
        const { error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/processor/{processorName}:start",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async startStreamProcessorWith(options: FetchOptions<operations["startGroupStreamProcessorWith"]>) {
        const { error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/processor/{processorName}:startWith",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async stopStreamProcessor(options: FetchOptions<operations["stopGroupStreamProcessor"]>) {
        const { error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/processor/{processorName}:stop",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
    }

    async getStreamProcessors(
        options: FetchOptions<operations["getGroupStreamProcessors"]>
    ): Promise<components["schemas"]["PaginatedApiStreamsStreamProcessorWithStatsView"]> {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}/processors",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async downloadOperationalLogs(options: FetchOptions<operations["downloadGroupStreamOperationalLogs"]>) {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/streams/{tenantName}:downloadOperationalLogs",
            { ...options, headers: { Accept: "application/vnd.atlas.2025-03-12+gzip", ...options?.headers } }
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async withStreamSampleConnections(
        options: FetchOptions<operations["withGroupStreamSampleConnections"]>
    ): Promise<components["schemas"]["StreamsTenant"]> {
        const { data, error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/streams:withSampleConnections",
            options
        );
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async listOrgs(
        options?: FetchOptions<operations["listOrgs"]>
    ): Promise<components["schemas"]["PaginatedOrganizationView"]> {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/orgs", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }

    async getOrgGroups(
        options: FetchOptions<operations["getOrgGroups"]>
    ): Promise<components["schemas"]["PaginatedAtlasGroupView"]> {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/orgs/{orgId}/groups", options);
        if (error) {
            throw ApiClientError.fromError({ response, error });
        }
        return data;
    }
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    // DO NOT EDIT. This is auto-generated code.
}
