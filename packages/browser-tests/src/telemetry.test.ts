import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { CompositeLogger, Keychain } from "@mongodb-js/mcp-core";
import { AtlasTelemetry as Telemetry } from "@mongodb-js/mcp-atlas-telemetry";
import type { DeviceId } from "@mongodb-js/mcp-tools-mongodb";

type MockTelemetrySession = {
    apiClient: ApiClient;
    logger: CompositeLogger;
    keychain: Keychain;
};

/**
 * Browser regression test: web-compatible Atlas telemetry and API client code
 * must be usable from a browser bundle. Embedders inject the platform
 * `fetch`/`Request` (the browser's `globalThis.fetch`) as the ApiClient's
 * `httpClient`, so the client and the telemetry auth provider never pull in
 * `@mongodb-js/devtools-proxy-support` (a node-fetch / Node-only helper that
 * throws in the browser polyfill). This test verifies that:
 *
 *   1. `ApiClient` can be constructed in the browser with an injected browser
 *      `httpClient` and no node-fetch / createFetch involvement.
 *   2. A `Telemetry` instance can be created, initialized, and used to emit +
 *      flush events end-to-end via `globalThis.fetch`, without any
 *      node-fetch related exceptions.
 */
describe("Telemetry in browser environment", () => {
    const API_BASE = "https://api.test.com/";

    let fetchSpy: MockInstance<typeof fetch>;
    const mockDeviceId = {
        get: vi.fn().mockResolvedValue("test-device-id"),
    } as unknown as DeviceId;

    function createMockSession(apiClient: ApiClient): MockTelemetrySession {
        return {
            apiClient,
            logger: new CompositeLogger(),
            keychain: new Keychain(),
        };
    }

    beforeEach(() => {
        fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    });

    afterEach(() => {
        fetchSpy.mockRestore();
        vi.clearAllMocks();
    });

    it("can construct an ApiClient with an injected browser httpClient", () => {
        expect(
            () =>
                new ApiClient(
                    {
                        baseUrl: API_BASE,
                        userAgent: "browser-test-agent/1.0.0",
                        httpClient: {
                            fetch: globalThis.fetch.bind(globalThis),
                            Request: globalThis.Request,
                        },
                    },
                    new CompositeLogger()
                )
        ).not.toThrow();
    });

    it("initializes Telemetry and sends events via the browser fetch without throwing", async () => {
        const apiClient = new ApiClient(
            {
                baseUrl: API_BASE,
                userAgent: "browser-test-agent/1.0.0",
                httpClient: {
                    fetch: globalThis.fetch.bind(globalThis),
                    Request: globalThis.Request,
                },
            },
            new CompositeLogger()
        );
        expect(apiClient.isAuthConfigured()).toBe(false);

        const session = createMockSession(apiClient);
        const telemetry = Telemetry.create({
            logger: session.logger,
            deviceId: mockDeviceId,
            apiClient,
            keychain: session.keychain,
            enabled: true,
            serverMetadata: { mcpServerName: "browser-test-server", version: "1.0.0" },
        });

        await expect(telemetry.setupPromise).resolves.toBeDefined();

        telemetry.emitEvents([
            {
                timestamp: new Date().toISOString(),
                source: "mdbmcp",
                properties: {
                    component: "browser-test",
                    duration_ms: 0,
                    result: "success",
                    category: "test",
                    command: "browser-command",
                },
            },
        ]);

        // `close()` performs a best-effort final flush of the event cache.
        // This is the failure path we care about: in a regressed build this
        // would throw synchronously inside ApiClient construction, or reject
        // here because node-fetch's Request is not available in the browser.
        await expect(telemetry.close()).resolves.toBeUndefined();

        const telemetryCall = fetchSpy.mock.calls.find(([input]) => {
            const href = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
            return href === new URL("api/private/unauth/telemetry/events", API_BASE).href;
        });

        expect(telemetryCall, "expected a POST to the unauth telemetry endpoint").toBeDefined();
        expect(telemetryCall?.[1]?.method).toBe("POST");
    });
});
