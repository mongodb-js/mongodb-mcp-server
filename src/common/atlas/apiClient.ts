import createClient from "openapi-fetch";
import type { ClientOptions, FetchOptions, Client, Middleware } from "openapi-fetch";
import { ApiClientError } from "./apiClientError.js";
import type { paths, operations } from "./openapi.js";
import type { CommonProperties, TelemetryEvent } from "../../telemetry/types.js";
import { packageInfo } from "../packageInfo.js";
import type { LoggerBase } from "../logger.js";
import { LogId } from "../logger.js";
import { createFetch } from "@mongodb-js/devtools-proxy-support";
import * as oauth from "oauth4webapi";
import { Request as NodeFetchRequest } from "node-fetch";

const ATLAS_API_VERSION = "2025-03-12";

export interface ApiClientCredentials {
    clientId: string;
    clientSecret: string;
}

export interface ApiClientOptions {
    credentials?: ApiClientCredentials;
    baseUrl: string;
    userAgent?: string;
}

export interface AccessToken {
    access_token: string;
    expires_at?: number;
}

export class ApiClient {
    private readonly options: {
        baseUrl: string;
        userAgent: string;
        credentials?: {
            clientId: string;
            clientSecret: string;
        };
    };

    // createFetch assumes that the first parameter of fetch is always a string
    // with the URL. However, fetch can also receive a Request object. While
    // the typechecking complains, createFetch does passthrough the parameters
    // so it works fine.
    private static customFetch: typeof fetch = createFetch({
        useEnvironmentVariableProxies: true,
    }) as unknown as typeof fetch;

    private client: Client<paths>;

    private oauth2Client?: oauth.Client;
    private oauth2Issuer?: oauth.AuthorizationServer;
    private accessToken?: AccessToken;

    public hasCredentials(): boolean {
        return !!this.oauth2Client && !!this.oauth2Issuer;
    }

    private isAccessTokenValid(): boolean {
        return !!(
            this.accessToken &&
            this.accessToken.expires_at !== undefined &&
            this.accessToken.expires_at > Date.now()
        );
    }

    private getAccessToken = async (): Promise<string | undefined> => {
        if (!this.hasCredentials()) {
            return undefined;
        }

        if (!this.isAccessTokenValid()) {
            this.accessToken = await this.getNewAccessToken();
        }

        return this.accessToken?.access_token;
    };

    private authMiddleware: Middleware = {
        onRequest: async ({ request, schemaPath }) => {
            if (schemaPath.startsWith("/api/private/unauth") || schemaPath.startsWith("/api/oauth")) {
                return undefined;
            }

            try {
                const accessToken = await this.getAccessToken();
                if (accessToken) {
                    request.headers.set("Authorization", `Bearer ${accessToken}`);
                }
                return request;
            } catch {
                // ignore not availble tokens, API will return 401
                return undefined;
            }
        },
    };

    constructor(
        options: ApiClientOptions,
        public readonly logger: LoggerBase
    ) {
        this.options = {
            ...options,
            userAgent:
                options.userAgent ||
                `AtlasMCP/${packageInfo.version} (${process.platform}; ${process.arch}; ${process.env.HOSTNAME || "unknown"})`,
        };

        this.client = createClient<paths>({
            baseUrl: this.options.baseUrl,
            headers: {
                "User-Agent": this.options.userAgent,
                Accept: `application/vnd.atlas.${ATLAS_API_VERSION}+json`,
            },
            fetch: ApiClient.customFetch,
            // NodeFetchRequest has more overloadings than the native Request
            // so it complains here. However, the interfaces are actually compatible
            // so it's not a real problem, just a type checking problem.
            Request: NodeFetchRequest as unknown as ClientOptions["Request"],
        });

        if (this.options.credentials?.clientId && this.options.credentials?.clientSecret) {
            this.oauth2Issuer = {
                issuer: this.options.baseUrl,
                token_endpoint: new URL("/api/oauth/token", this.options.baseUrl).toString(),
                revocation_endpoint: new URL("/api/oauth/revoke", this.options.baseUrl).toString(),
                token_endpoint_auth_methods_supported: ["client_secret_basic"],
                grant_types_supported: ["client_credentials"],
            };

            this.oauth2Client = {
                client_id: this.options.credentials.clientId,
                client_secret: this.options.credentials.clientSecret,
            };

            this.client.use(this.authMiddleware);
        }
    }

    private getOauthClientAuth(): { client: oauth.Client | undefined; clientAuth: oauth.ClientAuth | undefined } {
        if (this.options.credentials?.clientId && this.options.credentials.clientSecret) {
            const clientSecret = this.options.credentials.clientSecret;
            const clientId = this.options.credentials.clientId;

            // We are using our own ClientAuth because ClientSecretBasic URL encodes wrongly
            // the username and password (for example, encodes `_` to %5F, which is wrong).
            return {
                client: { client_id: clientId },
                clientAuth: (_as, client, _body, headers): void => {
                    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
                    headers.set("Authorization", `Basic ${credentials}`);
                },
            };
        }

        return { client: undefined, clientAuth: undefined };
    }

    private async getNewAccessToken(): Promise<AccessToken | undefined> {
        if (!this.hasCredentials() || !this.oauth2Issuer) {
            return undefined;
        }

        const { client, clientAuth } = this.getOauthClientAuth();
        if (client && clientAuth) {
            try {
                const response = await oauth.clientCredentialsGrantRequest(
                    this.oauth2Issuer,
                    client,
                    clientAuth,
                    new URLSearchParams(),
                    {
                        [oauth.customFetch]: ApiClient.customFetch,
                        headers: {
                            "User-Agent": this.options.userAgent,
                        },
                    }
                );

                const result = await oauth.processClientCredentialsResponse(this.oauth2Issuer, client, response);
                this.accessToken = {
                    access_token: result.access_token,
                    expires_at: Date.now() + (result.expires_in ?? 0) * 1000,
                };
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.logger.error({
                    id: LogId.atlasConnectFailure,
                    context: "apiClient",
                    message: `Failed to request access token: ${err.message}`,
                });
            }
            return this.accessToken;
        }

        return undefined;
    }

    public async validateAccessToken(): Promise<void> {
        await this.getAccessToken();
    }

    public async close(): Promise<void> {
        const { client, clientAuth } = this.getOauthClientAuth();
        try {
            if (this.oauth2Issuer && this.accessToken && client && clientAuth) {
                await oauth.revocationRequest(this.oauth2Issuer, client, clientAuth, this.accessToken.access_token);
            }
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error({
                id: LogId.atlasApiRevokeFailure,
                context: "apiClient",
                message: `Failed to revoke access token: ${err.message}`,
            });
        }
        this.accessToken = undefined;
    }

    public async getIpInfo(): Promise<{
        currentIpv4Address: string;
    }> {
        const accessToken = await this.getAccessToken();

        const endpoint = "api/private/ipinfo";
        const url = new URL(endpoint, this.options.baseUrl);
        const response = await fetch(url, {
            method: "GET",
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${accessToken}`,
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

    public async sendEvents(events: TelemetryEvent<CommonProperties>[]): Promise<void> {
        if (!this.options.credentials) {
            await this.sendUnauthEvents(events);
            return;
        }

        try {
            await this.sendAuthEvents(events);
        } catch (error) {
            if (error instanceof ApiClientError) {
                if (error.response.status !== 401) {
                    throw error;
                }
            }

            // send unauth events if any of the following are true:
            // 1: the token is not valid (not ApiClientError)
            // 2: if the api responded with 401 (ApiClientError with status 401)
            await this.sendUnauthEvents(events);
        }
    }

    private async sendAuthEvents(events: TelemetryEvent<CommonProperties>[]): Promise<void> {
        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error("No access token available");
        }
        const authUrl = new URL("api/private/v1.0/telemetry/events", this.options.baseUrl);
        const response = await fetch(authUrl, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "User-Agent": this.options.userAgent,
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(events),
        });

        if (!response.ok) {
            throw await ApiClientError.fromResponse(response);
        }
    }

    private async sendUnauthEvents(events: TelemetryEvent<CommonProperties>[]): Promise<void> {
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
        });

        if (!response.ok) {
            throw await ApiClientError.fromResponse(response);
        }
    }

    // DO NOT EDIT. This is auto-generated code.
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async listClustersForAllProjects(options?: FetchOptions<operations["listClustersForAllProjects"]>) {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/clusters", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async listProjects(options?: FetchOptions<operations["listProjects"]>) {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async createProject(options: FetchOptions<operations["createProject"]>) {
        const { data, error, response } = await this.client.POST("/api/atlas/v2/groups", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteProject(options: FetchOptions<operations["deleteProject"]>) {
        const { error, response } = await this.client.DELETE("/api/atlas/v2/groups/{groupId}", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async getProject(options: FetchOptions<operations["getProject"]>) {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups/{groupId}", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async listProjectIpAccessLists(options: FetchOptions<operations["listProjectIpAccessLists"]>) {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups/{groupId}/accessList", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async createProjectIpAccessList(options: FetchOptions<operations["createProjectIpAccessList"]>) {
        const { data, error, response } = await this.client.POST("/api/atlas/v2/groups/{groupId}/accessList", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteProjectIpAccessList(options: FetchOptions<operations["deleteProjectIpAccessList"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/accessList/{entryValue}",
            options
        );
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async listAlerts(options: FetchOptions<operations["listAlerts"]>) {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups/{groupId}/alerts", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async listClusters(options: FetchOptions<operations["listClusters"]>) {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups/{groupId}/clusters", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async createCluster(options: FetchOptions<operations["createCluster"]>) {
        const { data, error, response } = await this.client.POST("/api/atlas/v2/groups/{groupId}/clusters", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteCluster(options: FetchOptions<operations["deleteCluster"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/clusters/{clusterName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async getCluster(options: FetchOptions<operations["getCluster"]>) {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/clusters/{clusterName}",
            options
        );
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async listDatabaseUsers(options: FetchOptions<operations["listDatabaseUsers"]>) {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/databaseUsers",
            options
        );
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async createDatabaseUser(options: FetchOptions<operations["createDatabaseUser"]>) {
        const { data, error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/databaseUsers",
            options
        );
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteDatabaseUser(options: FetchOptions<operations["deleteDatabaseUser"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/databaseUsers/{databaseName}/{username}",
            options
        );
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async listFlexClusters(options: FetchOptions<operations["listFlexClusters"]>) {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/groups/{groupId}/flexClusters", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async createFlexCluster(options: FetchOptions<operations["createFlexCluster"]>) {
        const { data, error, response } = await this.client.POST(
            "/api/atlas/v2/groups/{groupId}/flexClusters",
            options
        );
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async deleteFlexCluster(options: FetchOptions<operations["deleteFlexCluster"]>) {
        const { error, response } = await this.client.DELETE(
            "/api/atlas/v2/groups/{groupId}/flexClusters/{name}",
            options
        );
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async getFlexCluster(options: FetchOptions<operations["getFlexCluster"]>) {
        const { data, error, response } = await this.client.GET(
            "/api/atlas/v2/groups/{groupId}/flexClusters/{name}",
            options
        );
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async listOrganizations(options?: FetchOptions<operations["listOrganizations"]>) {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/orgs", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async listOrganizationProjects(options: FetchOptions<operations["listOrganizationProjects"]>) {
        const { data, error, response } = await this.client.GET("/api/atlas/v2/orgs/{orgId}/groups", options);
        if (error) {
            throw ApiClientError.fromError(response, error);
        }
        return data;
    }

    // DO NOT EDIT. This is auto-generated code.
}
