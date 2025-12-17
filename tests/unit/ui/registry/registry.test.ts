import { describe, it, expect, beforeEach, vi } from "vitest";
import { UIRegistry } from "../../../../src/ui/registry/registry.js";

describe("UIRegistry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("get()", () => {
        it("should return custom UI when set", async () => {
            const customUIs = (toolName: string): string | null => {
                if (toolName === "list-databases") {
                    return "<html>custom list-databases UI</html>";
                }
                return null;
            };
            const registry = new UIRegistry({ customUIs });

            expect(await registry.get("list-databases")).toBe("<html>custom list-databases UI</html>");
        });

        it("should return null when no UI exists for the tool", async () => {
            const registry = new UIRegistry();

            expect(await registry.get("non-existent-tool")).toBeNull();
        });

        it("should return custom UI for new tools", async () => {
            const customUIs = (toolName: string): string | null => {
                if (toolName === "brand-new-tool") {
                    return "<html>brand new UI</html>";
                }
                return null;
            };
            const registry = new UIRegistry({ customUIs });

            expect(await registry.get("brand-new-tool")).toBe("<html>brand new UI</html>");
        });

        it("should prefer custom UI over bundled UI", async () => {
            const customUIs = (toolName: string): string | null => {
                if (toolName === "any-tool") {
                    return "<html>custom version</html>";
                }
                return null;
            };
            const registry = new UIRegistry({ customUIs });

            // Custom should be returned without attempting to load bundled
            expect(await registry.get("any-tool")).toBe("<html>custom version</html>");
        });

        it("should cache results after first load", async () => {
            const customUIs = (toolName: string): string | null => {
                if (toolName === "cached-tool") {
                    return "<html>cached UI</html>";
                }
                return null;
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
