/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRenderData } from "../../../src/ui/hooks/useRenderData.js";

interface TestData {
    items: string[];
}

describe("useRenderData", () => {
    let postMessageMock: ReturnType<typeof vi.fn>;
    let originalParent: typeof window.parent;

    beforeEach(() => {
        postMessageMock = vi.fn();
        originalParent = window.parent;

        // Mock window.parent.postMessage without replacing the entire window object
        Object.defineProperty(window, "parent", {
            value: { postMessage: postMessageMock },
            writable: true,
            configurable: true,
        });
    });

    afterEach(() => {
        Object.defineProperty(window, "parent", {
            value: originalParent,
            writable: true,
            configurable: true,
        });
        vi.restoreAllMocks();
    });

    it("returns initial state with isLoading true", () => {
        const { result } = renderHook(() => useRenderData<TestData>());

        expect(result.current.data).toBeNull();
        expect(result.current.isLoading).toBe(true);
        expect(result.current.error).toBeNull();
    });

    it("includes expected properties in return type", () => {
        const { result } = renderHook(() => useRenderData<TestData>());

        expect(result.current).toHaveProperty("data");
        expect(result.current).toHaveProperty("isLoading");
        expect(result.current).toHaveProperty("error");
    });

    it("returns a stable object shape for destructuring", () => {
        const { result } = renderHook(() => useRenderData<TestData>());

        const { data, isLoading, error } = result.current;

        expect(data).toBeNull();
        expect(isLoading).toBe(true);
        expect(error).toBeNull();
    });
});
