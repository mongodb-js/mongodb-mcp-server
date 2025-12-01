import { describe, expect, it } from "vitest";
import { AllTools, ToolBase } from "../../../src/tools/index.js";

describe("all exported tools", () => {
    it("'AllTools' should be a list of ToolBase implementations", () => {
        expect(AllTools).toBeInstanceOf(Array);
        AllTools.forEach((toolCtor) => {
            expect(Object.prototype.isPrototypeOf.call(ToolBase, toolCtor)).toBe(true);
        });
    });

    it("each tool in 'AllTools' list should have required static properties for ToolClass conformance", () => {
        AllTools.forEach((toolCtor) => {
            expect(toolCtor).toHaveProperty("category");
            expect(toolCtor).toHaveProperty("operationType");
        });
    });
});
