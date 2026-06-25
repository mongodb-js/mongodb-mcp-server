import type { FetchLike } from "@modelcontextprotocol/client";
import type { CachedToken, TokenResponse } from "./common.js";
import { packageInfo } from "./packageInfo.js";
import { logger } from "./logger.js";

const TOKEN_EXPIRY_BUFFER_MS = 10 * 60 * 1000; // 10 minutes

export class TokenError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "TokenError";
    }
}

export class TokenManager {
    private cachedToken: CachedToken | null = null;
    private refreshPromise: Promise<string> | null = null;

    private readonly userAgent = `mongodb-atlas-mcp-remote/${packageInfo.version} (${process.platform}; ${process.arch})`;

    constructor(
        private readonly tokenUrl: string,
        private readonly clientId: string,
        private readonly clientSecret: string,
        private readonly timeoutMs: number,
        private readonly fetch: FetchLike
    ) {}

    async getToken(): Promise<string> {
        if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
            return this.cachedToken.accessToken;
        }

        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        this.refreshPromise = this.fetchToken()
            .then((token) => {
                this.cachedToken = token;
                this.refreshPromise = null;
                return token.accessToken;
            })
            .catch((error) => {
                this.refreshPromise = null;
                throw error;
            });

        return this.refreshPromise;
    }

    invalidateToken(): void {
        this.cachedToken = null;
    }

    private async fetchToken(): Promise<CachedToken> {
        logger.debug("Fetching new access token");

        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");

        const response = await this.fetch(this.tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
                Authorization: `Basic ${credentials}`,
                "User-Agent": this.userAgent,
            },
            body: "grant_type=client_credentials",
            signal: AbortSignal.timeout(this.timeoutMs),
        }).catch((error: unknown) => {
            const isTimeout = error instanceof Error && error.name === "TimeoutError";
            throw new TokenError(
                isTimeout
                    ? `Token request timed out after ${this.timeoutMs}ms`
                    : `Token request failed: ${String(error)}`,
                0
            );
        });

        if (!response.ok) {
            const body = await response.text();
            throw new TokenError(`Token request failed with status ${response.status}: ${body}`, response.status);
        }

        const data = (await response.json()) as TokenResponse;

        if (!data.access_token) {
            throw new TokenError("Token response missing access_token", 0);
        }

        const expiresInS = data.expires_in ?? 3600;
        const token: CachedToken = {
            accessToken: data.access_token,
            expiresAt: Date.now() + expiresInS * 1000,
        };

        logger.debug(`Token acquired, expires in ${expiresInS}s`);
        return token;
    }
}
