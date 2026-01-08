import type { Middleware } from "openapi-fetch";
import type { LoggerBase } from "../../logger.js";
import { ClientCredentialsAuthClient } from "./clientCredentials.js";

export interface AccessToken {
    access_token: string;
    expires_at?: number;
}

export interface AuthClient {
    hasCredentials(): boolean;
    getAccessToken(): Promise<string | undefined>;
    validateAccessToken(): Promise<void>;
    revokeAccessToken(): Promise<void>;
    createAuthMiddleware(): Middleware;
    authHeaders(): Promise<Record<string, string> | undefined>;
}

export interface Credentials {
    clientId?: string;
    clientSecret?: string;
}

export interface AuthClientOptions {
    apiBaseUrl: string;
    userAgent: string;
    credentials: Credentials;
}

export class AuthClientBuilder {
    static build(options: AuthClientOptions, logger: LoggerBase): AuthClient | undefined {
        if (options.credentials.clientId && options.credentials.clientSecret) {
            return new ClientCredentialsAuthClient(
                {
                    baseUrl: options.apiBaseUrl,
                    userAgent: options.userAgent,
                    clientId: options.credentials.clientId,
                    clientSecret: options.credentials.clientSecret,
                },
                logger
            );
        }
        return undefined;
    }
}
