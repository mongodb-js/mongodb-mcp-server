import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { ApiClient, ClientCredentialsAuthProvider } from "@mongodb-js/mcp-atlas-api-client";
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
    return new ApiClient({
        options: {
            baseUrl: config.apiBaseUrl,
        },
        serverMetadata,
        logger,
        authProvider:
            config.apiClientId && config.apiClientSecret
                ? new ClientCredentialsAuthProvider({
                      options: {
                          baseUrl: config.apiBaseUrl,
                          clientId: config.apiClientId,
                          clientSecret: config.apiClientSecret,
                      },
                      serverMetadata,
                      logger,
                  })
                : undefined,
    });
}
