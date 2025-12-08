import { describe, it, expect, vi, beforeEach } from "vitest";
import { UIRegistry } from "../../../../src/ui/registry/registry.js";

// Mock the generated uiHtml module
vi.mock("../../../../src/ui/generated/uiHtml.js", () => ({
    uiHtml: {
        "list-databases": "<html>bundled list-databases UI</html>",
        find: "<html>bundled find UI</html>",
    } as Record<string, string>,
}));

describe("UIRegistry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("get()", () => {
        it("should return custom UI when set, overriding bundled UI", () => {
            const customUIs = {
                "list-databases": "<html>custom list-databases UI</html>",
            };
            const registry = new UIRegistry({ customUIs });

            expect(registry.get("list-databases")).toBe("<html>custom list-databases UI</html>");
        });

        it("should return bundled UI when no custom UI is set", () => {
            const registry = new UIRegistry();

            expect(registry.get("list-databases")).toBe("<html>bundled list-databases UI</html>");
            expect(registry.get("find")).toBe("<html>bundled find UI</html>");
        });

        it("should return undefined when no UI exists for the tool", () => {
            const registry = new UIRegistry();

            expect(registry.get("non-existent-tool")).toBeUndefined();
        });

        it("should return custom UI for new tools not in bundled UIs", () => {
            const customUIs = {
                "brand-new-tool": "<html>brand new UI</html>",
            };
            const registry = new UIRegistry({ customUIs });

            expect(registry.get("brand-new-tool")).toBe("<html>brand new UI</html>");
        });
    });

    describe("has()", () => {
        it("should return true for custom UI", () => {
            const customUIs = {
                "custom-tool": "<html>custom UI</html>",
            };
            const registry = new UIRegistry({ customUIs });

            expect(registry.has("custom-tool")).toBe(true);
        });

        it("should return true for bundled UI", () => {
            const registry = new UIRegistry();

            expect(registry.has("list-databases")).toBe(true);
            expect(registry.has("find")).toBe(true);
        });

        it("should return false for non-existent tool", () => {
            const registry = new UIRegistry();

            expect(registry.has("non-existent-tool")).toBe(false);
        });

        it("should return true when custom UI overrides bundled UI", () => {
            const customUIs = {
                "list-databases": "<html>custom list-databases UI</html>",
            };
            const registry = new UIRegistry({ customUIs });

            expect(registry.has("list-databases")).toBe(true);
        });
    });

    describe("getAvailableTools()", () => {
        it("should return bundled tool names when no custom UIs", () => {
            const registry = new UIRegistry();

            const tools = registry.getAvailableTools();
            expect(tools).toContain("list-databases");
            expect(tools).toContain("find");
            expect(tools).toHaveLength(2);
        });

        it("should return merged list of bundled and custom tool names", () => {
            const customUIs = {
                "custom-tool": "<html>custom UI</html>",
                "another-custom": "<html>another UI</html>",
            };
            const registry = new UIRegistry({ customUIs });

            const tools = registry.getAvailableTools();
            expect(tools).toContain("list-databases");
            expect(tools).toContain("find");
            expect(tools).toContain("custom-tool");
            expect(tools).toContain("another-custom");
            expect(tools).toHaveLength(4);
        });

        it("should not duplicate tool names when custom overrides bundled", () => {
            const customUIs = {
                "list-databases": "<html>custom list-databases UI</html>",
            };
            const registry = new UIRegistry({ customUIs });

            const tools = registry.getAvailableTools();
            const listDatabasesCount = tools.filter((t) => t === "list-databases").length;
            expect(listDatabasesCount).toBe(1);
            expect(tools).toHaveLength(2);
        });
    });
});
