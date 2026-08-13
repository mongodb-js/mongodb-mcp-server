import { afterEach, describe, expect, it, vi } from "vitest";
import { setupIntegrationTest, defaultTestConfig } from "../integrationHelpers.js";
import type { UIRegistry } from "@mongodb-js/mcp-ui";
import type { CliServer as Server } from "@mongodb-js/mcp-cli";

describe("CliServer UIRegistry selection", () => {
    let server: Server | undefined;
    let cleanup: () => Promise<void>;

    afterEach(async () => {
        await cleanup?.();
        server = undefined;
    });

    describe("UIRegistry conditional import", () => {
        it("should not set UIRegistry when mcpUI preview feature is not enabled", async () => {
            const integration = setupIntegrationTest(
                () => ({
                    ...defaultTestConfig,
                    previewFeatures: [], // mcpUI not included
                }),
                { tools: [] }
            );
            cleanup = async () => {
                await integration.mcpServer().close();
            };

            server = integration.mcpServer();
            expect(server.uiRegistry).toBeUndefined();
        });

        it("should set UIRegistry when mcpUI preview feature is enabled", async () => {
            const integration = setupIntegrationTest(
                () => ({
                    ...defaultTestConfig,
                    previewFeatures: ["mcpUI"],
                }),
                { tools: [] }
            );
            cleanup = async () => {
                await integration.mcpServer().close();
            };

            server = integration.mcpServer();
            expect(server.uiRegistry).toBeDefined();
            expect(server.uiRegistry).toHaveProperty("get");
            expect(typeof server.uiRegistry?.get).toBe("function");
        });

        it("should use provided UIRegistry from serverOptions when available", async () => {
            const mockUIRegistry: UIRegistry = {
                get: vi.fn(),
            } as unknown as UIRegistry;

            const integration = setupIntegrationTest(
                () => ({
                    ...defaultTestConfig,
                    previewFeatures: ["mcpUI"], // mcpUI enabled but should be ignored
                }),
                { tools: [], serverOptions: { uiRegistry: mockUIRegistry } }
            );
            cleanup = async () => {
                await integration.mcpServer().close();
            };

            server = integration.mcpServer();
            expect(server.uiRegistry).toBe(mockUIRegistry);
        });

        it("should use provided UIRegistry even when mcpUI is disabled", async () => {
            const mockUIRegistry: UIRegistry = {
                get: vi.fn(),
            } as unknown as UIRegistry;

            const integration = setupIntegrationTest(
                () => ({
                    ...defaultTestConfig,
                    previewFeatures: [], // mcpUI not enabled
                }),
                { tools: [], serverOptions: { uiRegistry: mockUIRegistry } }
            );
            cleanup = async () => {
                await integration.mcpServer().close();
            };

            server = integration.mcpServer();
            expect(server.uiRegistry).toBe(mockUIRegistry);
        });

        it("should handle multiple preview features with mcpUI included", async () => {
            const integration = setupIntegrationTest(
                () => ({
                    ...defaultTestConfig,
                    previewFeatures: ["mcpUI"],
                }),
                { tools: [] }
            );
            cleanup = async () => {
                await integration.mcpServer().close();
            };

            server = integration.mcpServer();
            expect(server.uiRegistry).toBeDefined();
            expect(server.uiRegistry).toHaveProperty("get");
            expect(typeof server.uiRegistry?.get).toBe("function");
        });
    });
});
