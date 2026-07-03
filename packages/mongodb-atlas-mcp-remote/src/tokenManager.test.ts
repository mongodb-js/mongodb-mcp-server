import type { Mock } from "vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager, TokenError } from "./tokenManager.js";
import type { FetchLike } from "@modelcontextprotocol/client";

const TEST_TOKEN_1 = "token-1";
const TEST_TOKEN_2 = "token-2";

function createManager(fetch: FetchLike): TokenManager {
    return new TokenManager("https://test.com/api/oauth/token", "client_id", "client_secret", 10_000, fetch);
}

function mockOkFetch(tokens: string[] = [TEST_TOKEN_1]): Mock {
    const mock = vi.fn();
    for (const token of tokens) {
        mock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => ({ access_token: token, expires_in: 3600 }),
        });
    }
    return mock;
}

describe("TokenManager", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("token fetching, caching and refreshing", () => {
        it("fetches a token on the first call", async () => {
            const mockFetch = mockOkFetch();
            const manager = createManager(mockFetch);
            const token = await manager.getToken();

            expect(token).toBe(TEST_TOKEN_1);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("returns the cached token on subsequent calls", async () => {
            const mockFetch = mockOkFetch();
            const manager = createManager(mockFetch);

            await manager.getToken();
            const token = await manager.getToken();

            expect(token).toBe(TEST_TOKEN_1);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("refreshes when within 10 minutes to expiration", async () => {
            const mockFetch = mockOkFetch([TEST_TOKEN_1, TEST_TOKEN_2]);
            const manager = createManager(mockFetch);

            const token1 = await manager.getToken();
            vi.setSystemTime(Date.now() + 51 * 60 * 1000);
            const token2 = await manager.getToken();

            expect(token1).toBe(TEST_TOKEN_1);
            expect(token2).toBe(TEST_TOKEN_2);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it("refreshes when the token is expired", async () => {
            const mockFetch = mockOkFetch([TEST_TOKEN_1, TEST_TOKEN_2]);
            const manager = createManager(mockFetch);

            const token1 = await manager.getToken();
            vi.setSystemTime(Date.now() + 61 * 60 * 1000);
            const token2 = await manager.getToken();

            expect(token1).toBe(TEST_TOKEN_1);
            expect(token2).toBe(TEST_TOKEN_2);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it("fetches a new token after invalidating", async () => {
            const mockFetch = mockOkFetch([TEST_TOKEN_1, TEST_TOKEN_2]);
            const manager = createManager(mockFetch);

            const token1 = await manager.getToken();
            manager.invalidateToken();
            const token2 = await manager.getToken();

            expect(token1).toBe(TEST_TOKEN_1);
            expect(token2).toBe(TEST_TOKEN_2);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });

    describe("single-flight refresh", () => {
        it("concurrent getToken() calls share a single fetch", async () => {
            const mockFetch = mockOkFetch();
            const manager = createManager(mockFetch);

            const [token1, token2] = await Promise.all([manager.getToken(), manager.getToken()]);

            expect(token1).toBe(TEST_TOKEN_1);
            expect(token2).toBe(TEST_TOKEN_1);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe("error cases", () => {
        it("throws TokenError with the HTTP status code on a non-OK response", async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 401,
                text: () => "Unauthorized",
            });
            const manager = createManager(mockFetch);

            const error = await manager.getToken().catch((e: unknown) => e);
            expect(error).toBeInstanceOf(TokenError);
            expect((error as TokenError).statusCode).toBe(401);
            expect((error as TokenError).message).toContain("Token request failed");
        });

        it("throws TokenError with a timeout message on TimeoutError", async () => {
            const mockFetch = vi.fn().mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
            const manager = createManager(mockFetch);

            const error = await manager.getToken().catch((e: unknown) => e);
            expect(error).toBeInstanceOf(TokenError);
            expect((error as TokenError).message).toContain("Token request timed out");
        });

        it("throws TokenError when access_token is missing from the response", async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => ({ expires_in: 3600 }),
            });
            const manager = createManager(mockFetch);

            const error = await manager.getToken().catch((e: unknown) => e);
            expect(error).toBeInstanceOf(TokenError);
            expect((error as TokenError).message).toContain("Token response missing access_token");
        });
    });
});
