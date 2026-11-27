import { vi, type Mock } from "vitest";
import type { HttpClient } from "@mongodb-js/mcp-atlas-api-client";

export type MockHttpClient = HttpClient & { fetch: Mock<HttpClient["fetch"]> };

/**
 * Builds an HttpClient for unit tests whose fetch never touches the network.
 * By default any call rejects, so an unexpected request fails the test loudly;
 * tests that expect a request should configure the response explicitly
 * (e.g. `httpClient.fetch.mockResolvedValueOnce(new Response(null, { status: 200 }))`).
 */
export function createMockHttpClient(): MockHttpClient {
    return {
        fetch: vi.fn<HttpClient["fetch"]>().mockImplementation((input) => {
            const url = input instanceof Request ? input.url : String(input);
            return Promise.reject(new Error(`Unexpected network call to ${url} in a unit test`));
        }),
        Request: globalThis.Request,
    };
}
