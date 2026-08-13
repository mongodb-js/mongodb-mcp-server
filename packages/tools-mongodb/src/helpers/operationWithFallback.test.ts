import { describe, it, expect, vi } from "vitest";
import { operationWithFallback } from "../../../src/helpers/operationWithFallback.js";

describe("operationWithFallback", () => {
    it("returns operation result when operation succeeds", async () => {
        const successfulOperation = vi.fn().mockResolvedValue("success");
        const fallbackValue = "fallback";

        const result = await operationWithFallback(successfulOperation, fallbackValue);

        expect(result).toBe("success");
        expect(successfulOperation).toHaveBeenCalledOnce();
    });

    it("returns fallback value when operation throws an error", async () => {
        const failingOperation = vi.fn().mockRejectedValue(new Error("Operation failed"));
        const fallbackValue = "fallback";

        const result = await operationWithFallback(failingOperation, fallbackValue);

        expect(result).toBe("fallback");
        expect(failingOperation).toHaveBeenCalledOnce();
    });
});
