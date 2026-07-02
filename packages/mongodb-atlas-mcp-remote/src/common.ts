// OAuth2 Token Response
export interface TokenResponse {
    access_token: string;
    expires_in?: number;
}

export interface CachedToken {
    accessToken: string;
    expiresAt: number;
}

export interface AppConfig {
    remoteUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    tokenTimeoutMs: number;
}
