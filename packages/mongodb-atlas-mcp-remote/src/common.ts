import type { JSONRPCMessage } from "@modelcontextprotocol/client";

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

export type HttpTransport = {
    start(): Promise<void>;
    close(): Promise<void>;
    send(message: JSONRPCMessage): Promise<void>;
    onmessage?: (message: JSONRPCMessage) => void;
    readonly sessionId?: string;
};
