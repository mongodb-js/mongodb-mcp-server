import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetch } from "@mongodb-js/devtools-proxy-support";

vi.mock("@mongodb-js/devtools-proxy-support", () => ({
    createFetch: vi.fn(),
}));

describe("getSharedProxyFetch", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.mocked(createFetch).mockReset();
    });

    afterEach(() => {
        vi.resetModules();
    });

    it("creates the proxy-aware fetch exactly once and memoizes it", async () => {
        const { getSharedProxyFetch: freshGetSharedProxyFetch } = await import("./proxyFetch.js");

        const mockFetch = vi.fn();
        vi.mocked(createFetch).mockReturnValue(mockFetch as never);

        const first = freshGetSharedProxyFetch();
        const second = freshGetSharedProxyFetch();
        const third = freshGetSharedProxyFetch();

        expect(first).toBe(second);
        expect(second).toBe(third);
        expect(createFetch).toHaveBeenCalledTimes(1);
        expect(createFetch).toHaveBeenCalledWith({ useEnvironmentVariableProxies: true });
    });

    it("getDefaultHttpClient pairs the shared fetch with the platform Request", async () => {
        const { getDefaultHttpClient: freshGetDefaultHttpClient, getSharedProxyFetch: freshGetSharedProxyFetch } =
            await import("./proxyFetch.js");

        const mockFetch = vi.fn();
        vi.mocked(createFetch).mockReturnValue(mockFetch as never);

        const client1 = freshGetDefaultHttpClient();
        const client2 = freshGetDefaultHttpClient();

        expect(client1.fetch).toBe(client2.fetch);
        expect(client1.fetch).toBe(freshGetSharedProxyFetch());
        expect(client1.Request).toBe(globalThis.Request);
        expect(createFetch).toHaveBeenCalledTimes(1);
    });
});
