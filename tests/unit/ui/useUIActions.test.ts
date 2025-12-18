import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { createElement, type FunctionComponent } from "react";
import { renderToString } from "react-dom/server";
import { useUIActions } from "../../../src/ui/hooks/useUIActions.js";

type UseUIActionsResult = ReturnType<typeof useUIActions>;

interface HookOptions {
    targetOrigin?: string;
}

/**
 * Simple hook testing utility that renders a component using the hook
 * and captures the result for assertions.
 */
function testHook(options?: HookOptions): UseUIActionsResult {
    let hookResult: UseUIActionsResult | undefined;

    const TestComponent: FunctionComponent = () => {
        hookResult = useUIActions(options);
        return null;
    };

    renderToString(createElement(TestComponent));

    if (!hookResult) {
        throw new Error("Hook did not return a result");
    }

    return hookResult;
}

describe("useUIActions", () => {
    let postMessageMock: Mock;
    let originalWindow: typeof globalThis.window;

    beforeEach(() => {
        originalWindow = globalThis.window;
        postMessageMock = vi.fn();

        // Create a minimal window mock with parent.postMessage
        globalThis.window = {
            parent: {
                postMessage: postMessageMock,
            },
        } as unknown as typeof globalThis.window;
    });

    afterEach(() => {
        globalThis.window = originalWindow;
        vi.restoreAllMocks();
    });

    it("intent() sends a message with name and params", () => {
        const actions = testHook();

        actions.intent("create-task", { title: "Test Task" });

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "intent",
                payload: {
                    intent: "create-task",
                    params: { title: "Test Task" },
                },
            },
            "*"
        );
    });

    it("intent() sends a message without params when not provided", () => {
        const actions = testHook();

        actions.intent("cancel");

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "intent",
                payload: {
                    intent: "cancel",
                    params: undefined,
                },
            },
            "*"
        );
    });

    it("notify() sends a notification message", () => {
        const actions = testHook();

        actions.notify("Operation completed successfully");

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "notify",
                payload: {
                    message: "Operation completed successfully",
                },
            },
            "*"
        );
    });

    it("prompt() sends a prompt message", () => {
        const actions = testHook();

        actions.prompt("What is the status of my database?");

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "prompt",
                payload: {
                    prompt: "What is the status of my database?",
                },
            },
            "*"
        );
    });

    it("tool() sends a tool message with name and params", () => {
        const actions = testHook();

        actions.tool("listDatabases", { connectionString: "mongodb://localhost" });

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "tool",
                payload: {
                    toolName: "listDatabases",
                    params: { connectionString: "mongodb://localhost" },
                },
            },
            "*"
        );
    });

    it("tool() sends a tool message without params when not provided", () => {
        const actions = testHook();

        actions.tool("getServerInfo");

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "tool",
                payload: {
                    toolName: "getServerInfo",
                    params: undefined,
                },
            },
            "*"
        );
    });

    it("link() sends a link message with a URL", () => {
        const actions = testHook();

        actions.link("https://mongodb.com/docs");

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "link",
                payload: {
                    url: "https://mongodb.com/docs",
                },
            },
            "*"
        );
    });

    it("reportSizeChange() sends size change with both dimensions", () => {
        const actions = testHook();

        actions.reportSizeChange({ width: 400, height: 300 });

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "ui-size-change",
                payload: { width: 400, height: 300 },
            },
            "*"
        );
    });

    it("reportSizeChange() sends size change with only width", () => {
        const actions = testHook();

        actions.reportSizeChange({ width: 500 });

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "ui-size-change",
                payload: { width: 500 },
            },
            "*"
        );
    });

    it("reportSizeChange() sends size change with only height", () => {
        const actions = testHook();

        actions.reportSizeChange({ height: 250 });

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "ui-size-change",
                payload: { height: 250 },
            },
            "*"
        );
    });

    it("uses custom targetOrigin when provided in options", () => {
        const actions = testHook({ targetOrigin: "https://example.com" });

        actions.notify("test message");

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "notify",
                payload: {
                    message: "test message",
                },
            },
            "https://example.com"
        );
    });

    it("defaults targetOrigin to '*' when not provided", () => {
        const actions = testHook();

        actions.notify("test message");

        expect(postMessageMock).toHaveBeenCalledWith(expect.any(Object), "*");
    });
});
