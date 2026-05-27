import { LRUCache } from "lru-cache";
import * as oauth from "oauth4webapi";
import { createFetch } from "@mongodb-js/devtools-proxy-support";
import type { LoggerBase } from "../../common/logging/index.js";
import { LogId } from "../../common/logging/index.js";

/**
 * A small wrapper around oauth4webapi's discovery + JWKS fetch that caches
 * the resolved AuthorizationServer metadata for a configurable TTL.
 *
 * The OIDC discovery document and the JWKS itself rarely change between
 * key-rotation events, so caching them per-issuer trades small amounts of
 * staleness for a large reduction in outbound traffic and per-request
 * latency on every authenticated MCP call.
 *
 * The cache key is the issuer URL. Failures are NOT cached; an issuer
 * temporarily unreachable will be retried on the next request.
 */
export class JwksCache {
    private readonly cache: LRUCache<string, oauth.AuthorizationServer>;
    private readonly customFetch: typeof fetch;
    private readonly logger: LoggerBase;

    constructor({ ttlMs, logger }: { ttlMs: number; logger: LoggerBase }) {
        this.cache = new LRUCache({ max: 8, ttl: ttlMs });
        this.logger = logger;
        this.customFetch = createFetch({ useEnvironmentVariableProxies: true }) as unknown as typeof fetch;
    }

    /**
     * Resolve the AuthorizationServer metadata for the given issuer URL,
     * fetching the discovery document on cache miss. Returned object is
     * suitable for passing to oauth4webapi's verification helpers.
     */
    public async getAuthorizationServer(issuer: string): Promise<oauth.AuthorizationServer> {
        const cached = this.cache.get(issuer);
        if (cached) {
            return cached;
        }

        const issuerUrl = new URL(issuer);
        let response: Response;
        try {
            response = await oauth.discoveryRequest(issuerUrl, {
                [oauth.customFetch]: this.customFetch,
            });
        } catch (cause) {
            this.logger.error({
                id: LogId.httpOAuthDiscoveryFailure,
                context: "oauthMiddleware",
                message: `Failed to fetch OIDC discovery document from ${issuer}: ${(cause as Error).message}`,
            });
            throw cause;
        }

        let server: oauth.AuthorizationServer;
        try {
            server = await oauth.processDiscoveryResponse(issuerUrl, response);
        } catch (cause) {
            this.logger.error({
                id: LogId.httpOAuthDiscoveryFailure,
                context: "oauthMiddleware",
                message: `Invalid OIDC discovery document from ${issuer}: ${(cause as Error).message}`,
            });
            throw cause;
        }

        this.cache.set(issuer, server);
        return server;
    }

    /** Clear all cached issuer metadata. Useful after key-rotation alarms. */
    public clear(): void {
        this.cache.clear();
    }
}
