// OAuth2 Token Response
export interface TokenResponse {
    access_token: string;
    expires_in?: number;
}

export interface CachedToken {
    accessToken: string;
    expiresAt: number;
}

export const LOG_LEVELS = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
    remoteUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    tokenTimeoutMs: number;
    logLevel: LogLevel;
}
