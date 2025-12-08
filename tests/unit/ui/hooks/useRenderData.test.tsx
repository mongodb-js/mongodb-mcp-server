import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRenderData } from "../../../../src/ui/hooks/useRenderData.js";

describe("useRenderData", () => {
    let postMessageSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        postMessageSpy = vi.spyOn(window.parent, "postMessage");
    });

    afterEach(() => {
        postMessageSpy.mockRestore();
    });

    it("should start in loading state", () => {
        const { result } = renderHook(() => useRenderData());
        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toBeNull();
        expect(result.current.error).toBeNull();
    });

    it("should post ready message on mount", () => {
        renderHook(() => useRenderData());
        expect(postMessageSpy).toHaveBeenCalledWith({ type: "ui-lifecycle-iframe-ready" }, "*");
    });

    it("should receive and set render data from postMessage", async () => {
        const { result } = renderHook(() => useRenderData<{ items: string[] }>());
        const testData = { items: ["a", "b", "c"] };

        act(() => {
            window.dispatchEvent(
                new MessageEvent("message", {
                    data: {
                        type: "ui-lifecycle-iframe-render-data",
                        payload: {
                            renderData: testData,
                        },
                    },
                })
            );
        });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.data).toEqual(testData);
        expect(result.current.error).toBeNull();
    });

    it("should ignore messages with different type", () => {
        const { result } = renderHook(() => useRenderData());

        act(() => {
            window.dispatchEvent(
                new MessageEvent("message", {
                    data: {
                        type: "some-other-message",
                        payload: { renderData: { test: true } },
                    },
                })
            );
        });

        // Should still be loading since we ignored the message
        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toBeNull();
    });

    it("should set error for invalid payload structure", async () => {
        const { result } = renderHook(() => useRenderData());

        act(() => {
            window.dispatchEvent(
                new MessageEvent("message", {
                    data: {
                        type: "ui-lifecycle-iframe-render-data",
                        payload: "invalid-not-an-object",
                    },
                })
            );
        });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.error).toBe("Invalid payload structure received");
        expect(result.current.data).toBeNull();
    });

    it("should set error when renderData is not an object", async () => {
        const { result } = renderHook(() => useRenderData());

        act(() => {
            window.dispatchEvent(
                new MessageEvent("message", {
                    data: {
                        type: "ui-lifecycle-iframe-render-data",
                        payload: {
                            renderData: "string-not-object",
                        },
                    },
                })
            );
        });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.error).toBe("Expected object but received string");
        expect(result.current.data).toBeNull();
    });

    it("should handle null renderData without error", async () => {
        const { result } = renderHook(() => useRenderData());

        act(() => {
            window.dispatchEvent(
                new MessageEvent("message", {
                    data: {
                        type: "ui-lifecycle-iframe-render-data",
                        payload: {
                            renderData: null,
                        },
                    },
                })
            );
        });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        // Null is intentionally allowed - not an error
        expect(result.current.error).toBeNull();
        expect(result.current.data).toBeNull();
    });

    it("should handle undefined renderData without error", async () => {
        const { result } = renderHook(() => useRenderData());

        act(() => {
            window.dispatchEvent(
                new MessageEvent("message", {
                    data: {
                        type: "ui-lifecycle-iframe-render-data",
                        payload: {},
                    },
                })
            );
        });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.error).toBeNull();
        expect(result.current.data).toBeNull();
    });

    it("should clean up message listener on unmount", () => {
        const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
        const { unmount } = renderHook(() => useRenderData());
        unmount();
        expect(removeEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));
        removeEventListenerSpy.mockRestore();
    });
});
