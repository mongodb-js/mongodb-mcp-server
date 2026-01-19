import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamableHttpRunner } from "../../../src/transports/streamableHttp.js";
import { defaultTestConfig } from "../helpers.js";
import type { UIRegistry } from "../../../src/ui/registry/index.js";
import type { Server } from "../../../src/server.js";

describe("TransportRunnerBase", () => {
    let server: Server | undefined;

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
    });

    describe("UIRegistry conditional import", () => {
        it("should not set UIRegistry when mcpUI preview feature is not enabled", async () => {
            const runner = new StreamableHttpRunner({
                userConfig: {
                    ...defaultTestConfig,
                    httpPort: 0,
                    previewFeatures: [], // mcpUI not included
                },
            });

            server = await runner["setupServer"]();

            expect(server.uiRegistry).toBeUndefined();
        });

        it("should set UIRegistry when mcpUI preview feature is enabled", async () => {
            const runner = new StreamableHttpRunner({
                userConfig: {
                    ...defaultTestConfig,
                    httpPort: 0,
                    previewFeatures: ["mcpUI"],
                },
            });

            server = await runner["setupServer"]();

            expect(server.uiRegistry).toBeDefined();
            expect(server.uiRegistry).toHaveProperty("get");
            expect(typeof server.uiRegistry?.get).toBe("function");
        });

        it("should use provided UIRegistry from serverOptions when available", async () => {
            const runner = new StreamableHttpRunner({
                userConfig: {
                    ...defaultTestConfig,
                    httpPort: 0,
                    previewFeatures: ["mcpUI"], // mcpUI enabled but should be ignored
                },
            });

            const mockUIRegistry: UIRegistry = {
                get: vi.fn(),
            } as unknown as UIRegistry;

            server = await runner["setupServer"](undefined, {
                serverOptions: { uiRegistry: mockUIRegistry },
            });

            // Should use the provided UIRegistry, not create a new one
            expect(server.uiRegistry).toBe(mockUIRegistry);
        });

        it("should not import UIRegistry when serverOptions provides one, even if mcpUI is disabled", async () => {
            const runner = new StreamableHttpRunner({
                userConfig: {
                    ...defaultTestConfig,
                    httpPort: 0,
                    previewFeatures: [], // mcpUI not enabled
                },
            });

            const mockUIRegistry: UIRegistry = {
                get: vi.fn(),
            } as unknown as UIRegistry;

            server = await runner["setupServer"](undefined, {
                serverOptions: { uiRegistry: mockUIRegistry },
            });

            // Should use the provided UIRegistry
            expect(server.uiRegistry).toBe(mockUIRegistry);
        });

        it("should handle multiple preview features with mcpUI included", async () => {
            const runner = new StreamableHttpRunner({
                userConfig: {
                    ...defaultTestConfig,
                    httpPort: 0,
                    previewFeatures: ["mcpUI", "search"],
                },
            });

            server = await runner["setupServer"]();

            expect(server.uiRegistry).toBeDefined();
            expect(server.uiRegistry).toHaveProperty("get");
            expect(typeof server.uiRegistry?.get).toBe("function");
        });
    });
});
