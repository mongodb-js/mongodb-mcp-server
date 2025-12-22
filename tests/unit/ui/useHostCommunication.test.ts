import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { createElement, type FunctionComponent } from "react";
import { renderToString } from "react-dom/server";
import { useHostCommunication } from "../../../src/ui/hooks/useHostCommunication.js";

type UseHostCommunicationResult = ReturnType<typeof useHostCommunication>;

/**
 * Simple hook testing utility that renders a component using the hook
 * and captures the result for assertions.
 */
function testHook(): UseHostCommunicationResult {
    let hookResult: UseHostCommunicationResult | undefined;

    const TestComponent: FunctionComponent = () => {
        hookResult = useHostCommunication();
        return null;
    };

    renderToString(createElement(TestComponent));

    if (!hookResult) {
        throw new Error("Hook did not return a result");
    }

    return hookResult;
}

describe("useHostCommunication", () => {
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

    it("intent() sends a message with empty params", () => {
        const actions = testHook();

        actions.intent("cancel", {});

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "intent",
                payload: {
                    intent: "cancel",
                    params: {},
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

    it("tool() sends a tool message with empty params", () => {
        const actions = testHook();

        actions.tool("getServerInfo", {});

        expect(postMessageMock).toHaveBeenCalledWith(
            {
                type: "tool",
                payload: {
                    toolName: "getServerInfo",
                    params: {},
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
});
