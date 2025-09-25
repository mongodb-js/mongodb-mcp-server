import { describe, it, expect, vi } from "vitest";
import type { UserConfig } from "../../../../src/common/config.js";
import { createAuthMiddleware } from "../../../../src/transports/auth/authMiddlewareFactory.js";

function baseConfig(overrides: Partial<UserConfig> = {}): UserConfig {
    return {
        // minimal required subset + defaults for fields used by factory
        apiBaseUrl: "https://example.com/",
        logPath: ".",
        exportsPath: ".",
        exportTimeoutMs: 0,
        exportCleanupIntervalMs: 0,
        disabledTools: [],
        telemetry: "disabled",
        readOnly: false,
        indexCheck: false,
        confirmationRequiredTools: [],
        transport: "http",
        httpPort: 0,
        httpHost: "127.0.0.1",
        loggers: ["stderr"],
        idleTimeoutMs: 0,
        notificationTimeoutMs: 0,
        httpHeaders: {},
        maxDocumentsPerQuery: 100,
        maxBytesPerQuery: 1024,
        atlasTemporaryDatabaseUserLifetimeMs: 0,
        httpAuthMode: "none",
        ...overrides,
    } as unknown as UserConfig; // casting to satisfy other unused fields from CliOptions
}

describe("authMiddlewareFactory", () => {
    it("returns passthrough middleware when mode is none", () => {
        const logger = { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), setAttribute: vi.fn() } as any;
        const mw = createAuthMiddleware(logger, baseConfig({ httpAuthMode: "none" }));
        let nextCalled = false;
        mw({} as any, {} as any, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
    });

    it("returns azure managed identity middleware when mode is azure-managed-identity", () => {
        const logger = { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), setAttribute: vi.fn() } as any;
        const cfg = baseConfig({
            httpAuthMode: "azure-managed-identity",
            azureManagedIdentityTenantId: "tenant",
            azureManagedIdentityClientId: "client",
        });
        const mw = createAuthMiddleware(logger, cfg);
        expect(typeof mw).toBe("function");
    });

    it("warns and falls back when mode is unknown", () => {
        const logger = { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), setAttribute: vi.fn() } as any;
        const mw = createAuthMiddleware(logger, baseConfig({ httpAuthMode: "mystery-mode" as any }));
        let nextCalled = false;
        mw({} as any, {} as any, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
        expect(logger.warning).toHaveBeenCalledTimes(1);
    });
});
