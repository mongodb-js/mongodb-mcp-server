import type { Middleware } from "openapi-fetch";
import type { LoggerBase } from "../../logger.js";
import { ClientCredentialsAuthProvider } from "./clientCredentials.js";

export interface AccessToken {
    access_token: string;
    expires_at?: number;
}

export interface AuthProvider {
    getAccessToken(): Promise<string | undefined>;
    revokeAccessToken(): Promise<void>;
    middleware(): Middleware;
    getAuthHeaders(): Promise<Record<string, string> | undefined>;
}

export interface Credentials {
    clientId?: string;
    clientSecret?: string;
}

export interface AuthProviderOptions {
    apiBaseUrl: string;
    userAgent: string;
    credentials: Credentials;
}

export class AuthProviderFactory {
    static create(options: AuthProviderOptions, logger: LoggerBase): AuthProvider | undefined {
        if (options.credentials.clientId && options.credentials.clientSecret) {
            return new ClientCredentialsAuthProvider(
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
