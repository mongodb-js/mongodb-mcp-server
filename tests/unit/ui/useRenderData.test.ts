import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, type FunctionComponent } from "react";
import { renderToString } from "react-dom/server";
import { useRenderData } from "../../../src/ui/hooks/useRenderData.js";

type UseRenderDataResult<T> = ReturnType<typeof useRenderData<T>>;

interface TestData {
    items: string[];
}

/**
 * Simple hook testing utility that renders a component using the hook
 * and captures the result for assertions.
 */
function testHook<T = unknown>(): UseRenderDataResult<T> {
    let hookResult: UseRenderDataResult<T> | undefined;

    const TestComponent: FunctionComponent = () => {
        hookResult = useRenderData<T>();
        return null;
    };

    renderToString(createElement(TestComponent));

    if (!hookResult) {
        throw new Error("Hook did not return a result");
    }

    return hookResult;
}

describe("useRenderData", () => {
    let postMessageMock: ReturnType<typeof vi.fn>;
    let originalWindow: typeof globalThis.window;

    beforeEach(() => {
        originalWindow = globalThis.window;
        postMessageMock = vi.fn();

        globalThis.window = {
            parent: {
                postMessage: postMessageMock,
            },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as typeof globalThis.window;
    });

    afterEach(() => {
        globalThis.window = originalWindow;
        vi.restoreAllMocks();
    });

    it("returns initial state with isLoading true", () => {
        const result = testHook<TestData>();

        expect(result.data).toBeNull();
        expect(result.isLoading).toBe(true);
        expect(result.error).toBeNull();
    });

    it("returns parentOrigin as null initially", () => {
        const result = testHook<TestData>();

        expect(result.parentOrigin).toBeNull();
    });

    it("includes parentOrigin in return type", () => {
        const result = testHook<TestData>();

        // Verify the hook returns the expected shape with parentOrigin
        expect(result).toHaveProperty("data");
        expect(result).toHaveProperty("isLoading");
        expect(result).toHaveProperty("error");
        expect(result).toHaveProperty("parentOrigin");
    });

    it("returns a stable object shape for destructuring", () => {
        const { data, isLoading, error, parentOrigin } = testHook<TestData>();

        expect(data).toBeNull();
        expect(isLoading).toBe(true);
        expect(error).toBeNull();
        expect(parentOrigin).toBeNull();
    });
});
