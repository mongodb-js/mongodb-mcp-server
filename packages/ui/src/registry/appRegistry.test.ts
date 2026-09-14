import { describe, it, expect } from "vitest";
import { MCP_APPS_RESOURCE_MIME_TYPE } from "@mongodb-js/mcp-types";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps";
import { AppRegistry } from "./appRegistry.js";

describe("MCP Apps constants", () => {
    it("pins the declared resource MIME type to the SDK's", () => {
        // packages/types hand-declares the constant (it must not depend on the
        // SDK); this keeps the declaration honest.
        expect(MCP_APPS_RESOURCE_MIME_TYPE).toBe(RESOURCE_MIME_TYPE);
    });
});

describe("AppRegistry", () => {
    describe("has()", () => {
        it("returns true only for tools with a registered app", () => {
            const registry = new AppRegistry();
            expect(registry.has("explain")).toBe(true);
            // list-databases is an mcp-ui widget, not an MCP App
            expect(registry.has("list-databases")).toBe(false);
            expect(registry.has("nonexistent-tool")).toBe(false);
        });
    });

    describe("resourceUriFor()", () => {
        it("returns the app resource URI for registered tools", () => {
            expect(new AppRegistry().resourceUriFor("explain")).toBe("ui://explain");
        });

        it("returns undefined for unregistered tools", () => {
            expect(new AppRegistry().resourceUriFor("list-databases")).toBeUndefined();
        });
    });

    describe("list()", () => {
        it("returns all app resources", () => {
            expect(new AppRegistry().list()).toEqual([{ toolName: "explain", resourceUri: "ui://explain" }]);
        });
    });

    describe("getHtml()", () => {
        it("returns the bundled app HTML and caches it", async () => {
            const registry = new AppRegistry();
            const html = await registry.getHtml("explain");
            expect(html).toMatch(/^<!doctype html>/i);
            expect(await registry.getHtml("explain")).toBe(html);
        });

        it("returns null for unknown tools", async () => {
            expect(await new AppRegistry().getHtml("nope")).toBeNull();
        });
    });
});
