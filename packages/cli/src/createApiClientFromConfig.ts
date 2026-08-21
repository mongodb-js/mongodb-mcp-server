import { ApiClient, type HttpClient, userAgentFromServerMetadata } from "@mongodb-js/mcp-atlas-api-client";
import { getDefaultHttpClient } from "@mongodb-js/mcp-fetch";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ServerMetadata } from "@mongodb-js/mcp-types";
import type { UserConfig } from "./config/userConfig.js";

export type CreateApiClientFromConfigOptions = {
    config: UserConfig;
    serverMetadata: ServerMetadata;
    logger: CompositeLogger;
};

export function createApiClientFromConfig({
    config,
    serverMetadata,
    logger,
}: CreateApiClientFromConfigOptions): ApiClient {
    // Shared, memoized proxy-aware fetch (see @mongodb-js/mcp-fetch).
    const httpClient: HttpClient = getDefaultHttpClient();

    return new ApiClient(
        {
            baseUrl: config.apiBaseUrl,
            userAgent: userAgentFromServerMetadata(serverMetadata),
            credentials: {
                clientId: config.apiClientId,
                clientSecret: config.apiClientSecret,
            },
            httpClient,
        },
        logger
    );
}
