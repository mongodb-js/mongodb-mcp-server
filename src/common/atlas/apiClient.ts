import config from "../../config.js";
import createClient, { FetchOptions, Middleware } from "openapi-fetch";
import { AccessToken, ClientCredentials } from "simple-oauth2";

import { paths, operations } from "./openapi.js";

export class ApiClientError extends Error {
    response?: Response;

    constructor(message: string, response: Response | undefined = undefined) {
        super(message);
        this.name = "ApiClientError";
        this.response = response;
    }

    static async fromResponse(response: Response, message?: string): Promise<ApiClientError> {
        message ||= `error calling Atlas API`;
        try {
            const text = await response.text();
            return new ApiClientError(`${message}: [${response.status} ${response.statusText}] ${text}`, response);
        } catch {
            return new ApiClientError(`${message}: ${response.status} ${response.statusText}`, response);
        }
    }
}

export interface ApiClientOptions {
    credentials: {
        clientId: string;
        clientSecret: string;
    };
    baseUrl?: string;
}

export class ApiClient {
    private client = createClient<paths>({
        baseUrl: config.apiBaseUrl,
        headers: {
            "User-Agent": config.userAgent,
            Accept: `application/vnd.atlas.${config.atlasApiVersion}+json`,
        },
    });
    private oauth2Client = new ClientCredentials({
        client: {
            id: this.options.credentials.clientId,
            secret: this.options.credentials.clientSecret,
        },
        auth: {
            tokenHost: this.options.baseUrl || config.apiBaseUrl,
            tokenPath: "/api/oauth/token",
        },
    });
    private accessToken?: AccessToken;

    private getAccessToken = async () => {
        if (!this.accessToken || this.accessToken.expired()) {
            this.accessToken = await this.oauth2Client.getToken({});
        }
        return this.accessToken.token.access_token;
    };

    private authMiddleware = (apiClient: ApiClient): Middleware => ({
        async onRequest({ request, schemaPath }) {
            if (schemaPath.startsWith("/api/private/unauth") || schemaPath.startsWith("/api/oauth")) {
                return undefined;
            }

            try {
                const accessToken = await apiClient.getAccessToken();
                request.headers.set("Authorization", `Bearer ${accessToken}`);
                return request;
            } catch {
                // ignore not availble tokens, API will return 401
            }
        },
    });
    private errorMiddleware = (): Middleware => ({
        async onResponse({ response }) {
            if (!response.ok) {
                throw await ApiClientError.fromResponse(response);
            }
        },
    });

    constructor(private options: ApiClientOptions) {
        this.client.use(this.authMiddleware(this));
        this.client.use(this.errorMiddleware());
    }

    async getIpInfo() {
        const accessToken = await this.getAccessToken();

        const endpoint = "api/private/ipinfo";
        const url = new URL(endpoint, config.apiBaseUrl);
        const response = await fetch(url, {
            method: "GET",
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${accessToken}`,
                "User-Agent": config.userAgent,
            },
        });

        if (!response.ok) {
            throw await ApiClientError.fromResponse(response);
        }

        const responseBody = await response.json();
        return responseBody as {
            currentIpv4Address: string;
        };
    }

    async listProjects(options?: FetchOptions<operations["listProjects"]>) {
        const { data } = await this.client.GET(`/api/atlas/v2/groups`, options);
        return data;
    }

    async listProjectIpAccessLists(options: FetchOptions<operations["listProjectIpAccessLists"]>) {
        const { data } = await this.client.GET(`/api/atlas/v2/groups/{groupId}/accessList`, options);
        return data;
    }

    async createProjectIpAccessList(options: FetchOptions<operations["createProjectIpAccessList"]>) {
        const { data } = await this.client.POST(`/api/atlas/v2/groups/{groupId}/accessList`, options);
        return data;
    }

    async getProject(options: FetchOptions<operations["getProject"]>) {
        const { data } = await this.client.GET(`/api/atlas/v2/groups/{groupId}`, options);
        return data;
    }

    async listClusters(options: FetchOptions<operations["listClusters"]>) {
        const { data } = await this.client.GET(`/api/atlas/v2/groups/{groupId}/clusters`, options);
        return data;
    }

    async listClustersForAllProjects(options?: FetchOptions<operations["listClustersForAllProjects"]>) {
        const { data } = await this.client.GET(`/api/atlas/v2/clusters`, options);
        return data;
    }

    async getCluster(options: FetchOptions<operations["getCluster"]>) {
        const { data } = await this.client.GET(`/api/atlas/v2/groups/{groupId}/clusters/{clusterName}`, options);
        return data;
    }

    async createCluster(options: FetchOptions<operations["createCluster"]>) {
        const { data } = await this.client.POST("/api/atlas/v2/groups/{groupId}/clusters", options);
        return data;
    }

    async createDatabaseUser(options: FetchOptions<operations["createDatabaseUser"]>) {
        const { data } = await this.client.POST("/api/atlas/v2/groups/{groupId}/databaseUsers", options);
        return data;
    }

    async listDatabaseUsers(options: FetchOptions<operations["listDatabaseUsers"]>) {
        const { data } = await this.client.GET(`/api/atlas/v2/groups/{groupId}/databaseUsers`, options);
        return data;
    }
}
