import { describe, it, expect, beforeEach, vi } from "vitest";
import { UIRegistry } from "../../../../src/ui/registry/registry.js";

describe("UIRegistry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("get()", () => {
        it("should return custom UI when set", async () => {
            const customUIs = {
                "list-databases": "<html>custom list-databases UI</html>",
            };
            const registry = new UIRegistry({ customUIs });

            expect(await registry.get("list-databases")).toBe("<html>custom list-databases UI</html>");
        });

        it("should return null when no UI exists for the tool", async () => {
            const registry = new UIRegistry();

            expect(await registry.get("non-existent-tool")).toBeNull();
        });

        it("should return custom UI for new tools", async () => {
            const customUIs = {
                "brand-new-tool": "<html>brand new UI</html>",
            };
            const registry = new UIRegistry({ customUIs });

            expect(await registry.get("brand-new-tool")).toBe("<html>brand new UI</html>");
        });

        it("should prefer custom UI over bundled UI", async () => {
            const customUIs = {
                "any-tool": "<html>custom version</html>",
            };
            const registry = new UIRegistry({ customUIs });

            // Custom should be returned without attempting to load bundled
            expect(await registry.get("any-tool")).toBe("<html>custom version</html>");
        });

        it("should cache results after first load", async () => {
            const customUIs = {
                "cached-tool": "<html>cached UI</html>",
            };
            const registry = new UIRegistry({ customUIs });

            // First call
            const first = await registry.get("cached-tool");
            // Second call should return same result
            const second = await registry.get("cached-tool");

            expect(first).toBe(second);
            expect(first).toBe("<html>cached UI</html>");
        });
    });
});
