import { describe, it, expect, vi, beforeEach } from "vitest";
import { JwksCache } from "../../../../src/transports/auth/jwksCache.js";
import type { LoggerBase } from "../../../../src/common/logging/index.js";

// Mock oauth4webapi so we control the discovery response without doing
// real network I/O. Each test below shapes the mock for the scenario
// it cares about (success / failed network / malformed response).
vi.mock("oauth4webapi", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        discoveryRequest: vi.fn(),
        processDiscoveryResponse: vi.fn(),
    };
});

vi.mock("@mongodb-js/devtools-proxy-support", () => ({
    createFetch: vi.fn(() => globalThis.fetch),
}));

import * as oauth from "oauth4webapi";

const discoveryRequest = oauth.discoveryRequest as unknown as ReturnType<typeof vi.fn>;
const processDiscoveryResponse = oauth.processDiscoveryResponse as unknown as ReturnType<typeof vi.fn>;

const ISSUER = "https://issuer.example.com";

describe("JwksCache", () => {
    let logger: LoggerBase;

    beforeEach(() => {
        discoveryRequest.mockReset();
        processDiscoveryResponse.mockReset();
        logger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as LoggerBase;
    });

    it("fetches the discovery document on cache miss", async () => {
        const cache = new JwksCache({ ttlMs: 60_000, logger });
        const fakeResponse = new Response("{}");
        discoveryRequest.mockResolvedValueOnce(fakeResponse);
        processDiscoveryResponse.mockResolvedValueOnce({ issuer: ISSUER });

        const result = await cache.getAuthorizationServer(ISSUER);

        expect(result).toEqual({ issuer: ISSUER });
        expect(discoveryRequest).toHaveBeenCalledTimes(1);
        expect(processDiscoveryResponse).toHaveBeenCalledTimes(1);
    });

    it("returns the cached value on subsequent calls (single fetch)", async () => {
        const cache = new JwksCache({ ttlMs: 60_000, logger });
        discoveryRequest.mockResolvedValue(new Response("{}"));
        processDiscoveryResponse.mockResolvedValue({ issuer: ISSUER });

        await cache.getAuthorizationServer(ISSUER);
        await cache.getAuthorizationServer(ISSUER);
        await cache.getAuthorizationServer(ISSUER);

        // Three calls, exactly one network fetch.
        expect(discoveryRequest).toHaveBeenCalledTimes(1);
    });

    it("does not cache failures - the next call retries the network", async () => {
        const cache = new JwksCache({ ttlMs: 60_000, logger });
        discoveryRequest.mockRejectedValueOnce(new Error("ECONNREFUSED")).mockResolvedValueOnce(new Response("{}"));
        processDiscoveryResponse.mockResolvedValueOnce({ issuer: ISSUER });

        await expect(cache.getAuthorizationServer(ISSUER)).rejects.toThrow("ECONNREFUSED");
        await expect(cache.getAuthorizationServer(ISSUER)).resolves.toEqual({ issuer: ISSUER });
        expect(discoveryRequest).toHaveBeenCalledTimes(2);
    });

    it("logs an error when discovery fails", async () => {
        const cache = new JwksCache({ ttlMs: 60_000, logger });
        discoveryRequest.mockRejectedValueOnce(new Error("DNS failure"));

        await expect(cache.getAuthorizationServer(ISSUER)).rejects.toThrow("DNS failure");
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("DNS failure") as unknown,
            })
        );
    });

    it("logs an error when discovery returns an invalid response", async () => {
        const cache = new JwksCache({ ttlMs: 60_000, logger });
        discoveryRequest.mockResolvedValueOnce(new Response("not json"));
        processDiscoveryResponse.mockRejectedValueOnce(new Error("not a valid OIDC discovery doc"));

        await expect(cache.getAuthorizationServer(ISSUER)).rejects.toThrow("not a valid OIDC discovery doc");
        expect(logger.error).toHaveBeenCalled();
    });

    it("clear() evicts cached entries", async () => {
        const cache = new JwksCache({ ttlMs: 60_000, logger });
        discoveryRequest.mockResolvedValue(new Response("{}"));
        processDiscoveryResponse.mockResolvedValue({ issuer: ISSUER });

        await cache.getAuthorizationServer(ISSUER);
        cache.clear();
        await cache.getAuthorizationServer(ISSUER);

        expect(discoveryRequest).toHaveBeenCalledTimes(2);
    });
});
