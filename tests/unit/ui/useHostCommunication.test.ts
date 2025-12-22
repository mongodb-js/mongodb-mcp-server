/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHostCommunication } from "../../../src/ui/hooks/useHostCommunication.js";

describe("useHostCommunication", () => {
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

    it("intent() sends a message with name and params", () => {
        const { result } = renderHook(() => useHostCommunication());

        result.current.intent("create-task", { title: "Test Task" });

        expect(postMessageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "intent",
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                payload: expect.objectContaining({
                    intent: "create-task",
                    params: { title: "Test Task" },
                }),
            }),
            "*"
        );
    });

    it("intent() sends a message with empty params", () => {
        const { result } = renderHook(() => useHostCommunication());

        result.current.intent("cancel", {});

        expect(postMessageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "intent",
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                payload: expect.objectContaining({
                    intent: "cancel",
                    params: {},
                }),
            }),
            "*"
        );
    });

    it("notify() sends a notification message", () => {
        const { result } = renderHook(() => useHostCommunication());

        result.current.notify("Operation completed successfully");

        expect(postMessageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "notify",
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                payload: expect.objectContaining({
                    message: "Operation completed successfully",
                }),
            }),
            "*"
        );
    });

    it("prompt() sends a prompt message", () => {
        const { result } = renderHook(() => useHostCommunication());

        result.current.prompt("What is the status of my database?");

        expect(postMessageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "prompt",
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                payload: expect.objectContaining({
                    prompt: "What is the status of my database?",
                }),
            }),
            "*"
        );
    });

    it("tool() sends a tool message with name and params", () => {
        const { result } = renderHook(() => useHostCommunication());

        result.current.tool("listDatabases", { connectionString: "mongodb://localhost" });

        expect(postMessageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "tool",
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                payload: expect.objectContaining({
                    toolName: "listDatabases",
                    params: { connectionString: "mongodb://localhost" },
                }),
            }),
            "*"
        );
    });

    it("tool() sends a tool message with empty params", () => {
        const { result } = renderHook(() => useHostCommunication());

        result.current.tool("getServerInfo", {});

        expect(postMessageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "tool",
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                payload: expect.objectContaining({
                    toolName: "getServerInfo",
                    params: {},
                }),
            }),
            "*"
        );
    });

    it("link() sends a link message with a URL", () => {
        const { result } = renderHook(() => useHostCommunication());

        result.current.link("https://mongodb.com/docs");

        expect(postMessageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "link",
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                payload: expect.objectContaining({
                    url: "https://mongodb.com/docs",
                }),
            }),
            "*"
        );
    });
});
