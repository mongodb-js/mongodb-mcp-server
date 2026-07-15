import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ApiClient,
    CompositeLogger,
    Keychain,
    Telemetry,
    type DeviceId,
    type Session,
    UserConfigSchema,
} from "mongodb-mcp-server/web";

/**
 * Browser regression test: the MCP server ships a `mongodb-mcp-server/web`
 * entrypoint that must be usable from a browser bundle. Historically the
 * `ApiClient` constructor and the telemetry auth provider both called
 * `createFetch` from `@mongodb-js/devtools-proxy-support` — a node-fetch /
 * Node-only helper that throws in the browser polyfill. This test verifies
 * that:
 *
 *   1. `ApiClient` can be constructed in the browser without invoking
 *      `createFetch` (i.e. it must detect the environment and fall back to
 *      `globalThis.fetch`).
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

    function createMockSession(apiClient: ApiClient): Session {
        return {
            apiClient,
            sessionId: "browser-session-id",
            mcpClient: { name: "browser-test-client", version: "1.0.0" },
            logger: new CompositeLogger(),
            keychain: new Keychain(),
        } as unknown as Session;
    }

    beforeEach(() => {
        fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    });

    afterEach(() => {
        fetchSpy.mockRestore();
        vi.clearAllMocks();
    });

    it("can construct an ApiClient without throwing due to node-fetch / createFetch", () => {
        expect(
            () => new ApiClient({ baseUrl: API_BASE, userAgent: "browser-test-agent" }, new CompositeLogger())
        ).not.toThrow();
    });

    it("initializes Telemetry and sends events via the browser fetch without throwing", async () => {
        const apiClient = new ApiClient({ baseUrl: API_BASE, userAgent: "browser-test-agent" }, new CompositeLogger());
        expect(apiClient.isAuthConfigured()).toBe(false);

        const telemetry = Telemetry.create(
            createMockSession(apiClient),
            UserConfigSchema.parse({ telemetry: "enabled" }),
            mockDeviceId
        );

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
        expect(telemetryCall![1]?.method).toBe("POST");
    });
});
