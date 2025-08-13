import { defaultDriverOptions, defaultTestConfig, expectDefined, setupIntegrationTest } from "./helpers.js";
import { describeWithMongoDB } from "./tools/mongodb/mongodbHelpers.js";
import { describe, expect, it } from "vitest";

describe("Server integration test", () => {
    describeWithMongoDB(
        "without atlas",
        (integration) => {
            it("should return positive number of tools and have no atlas tools", async () => {
                const tools = await integration.mcpClient().listTools();
                expectDefined(tools);
                expect(tools.tools.length).toBeGreaterThan(0);

                const atlasTools = tools.tools.filter((tool) => tool.name.startsWith("atlas-"));
                expect(atlasTools.length).toBeLessThanOrEqual(0);
            });
        },
        () => ({
            ...defaultTestConfig,
            apiClientId: undefined,
            apiClientSecret: undefined,
        }),
        () => defaultDriverOptions
    );

    describe("with atlas", () => {
        const integration = setupIntegrationTest(
            () => ({
                ...defaultTestConfig,
                apiClientId: "test",
                apiClientSecret: "test",
            }),
            () => defaultDriverOptions
        );

        describe("list capabilities", () => {
            it("should return positive number of tools and have some atlas tools", async () => {
                const tools = await integration.mcpClient().listTools();
                expectDefined(tools);
                expect(tools.tools.length).toBeGreaterThan(0);

                const atlasTools = tools.tools.filter((tool) => tool.name.startsWith("atlas-"));
                expect(atlasTools.length).toBeGreaterThan(0);
            });

            it("should return no prompts", async () => {
                await expect(() => integration.mcpClient().listPrompts()).rejects.toMatchObject({
                    message: "MCP error -32601: Method not found",
                });
            });

            it("should return capabilities", () => {
                const capabilities = integration.mcpClient().getServerCapabilities();
                expectDefined(capabilities);
                expectDefined(capabilities?.logging);
                expectDefined(capabilities?.completions);
                expectDefined(capabilities?.tools);
                expectDefined(capabilities?.resources);
                expect(capabilities.experimental).toBeUndefined();
                expect(capabilities.prompts).toBeUndefined();
            });
        });
    });

    describe("with read-only mode", () => {
        const integration = setupIntegrationTest(
            () => ({
                ...defaultTestConfig,
                readOnly: true,
                apiClientId: "test",
                apiClientSecret: "test",
            }),
            () => defaultDriverOptions
        );

        it("should only register read and metadata operation tools when read-only mode is enabled", async () => {
            const tools = await integration.mcpClient().listTools();
            expectDefined(tools);
            expect(tools.tools.length).toBeGreaterThan(0);

            // Check that we have some tools available (the read and metadata ones)
            expect(tools.tools.some((tool) => tool.name === "find")).toBe(true);
            expect(tools.tools.some((tool) => tool.name === "collection-schema")).toBe(true);
            expect(tools.tools.some((tool) => tool.name === "list-databases")).toBe(true);
            expect(tools.tools.some((tool) => tool.name === "atlas-list-orgs")).toBe(true);
            expect(tools.tools.some((tool) => tool.name === "atlas-list-projects")).toBe(true);

            // Check that non-read tools are NOT available
            expect(tools.tools.some((tool) => tool.name === "insert-one")).toBe(false);
            expect(tools.tools.some((tool) => tool.name === "update-many")).toBe(false);
            expect(tools.tools.some((tool) => tool.name === "delete-one")).toBe(false);
            expect(tools.tools.some((tool) => tool.name === "drop-collection")).toBe(false);
        });
    });
});
