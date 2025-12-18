import { useCallback, useMemo } from "react";

/** Options for sending a message */
interface SendMessageOptions {
    /** Target origin for postMessage. Defaults to "*" */
    targetOrigin?: string;
}

/** Return type for the useUIActions hook */
interface UseUIActionsResult {
    /**
     * Sends an intent message to the host.
     * Indicates the user has interacted with the UI and expressed an intent for the host to act on.
     * @param intent - The intent identifier
     * @param params - Optional parameters for the intent
     */
    intent: <T = unknown>(intent: string, params?: T) => void;

    /**
     * Sends a notify message to the host.
     * Indicates the iframe already acted upon user interaction and is notifying the host.
     * @param message - The notification message
     */
    notify: (message: string) => void;

    /**
     * Sends a prompt message to the host.
     * Asks the host to run a prompt.
     * @param prompt - The prompt text to run
     */
    prompt: (prompt: string) => void;

    /**
     * Sends a tool call message to the host.
     * Asks the host to execute a tool.
     * @param toolName - The name of the tool to call
     * @param params - Optional parameters for the tool
     */
    tool: <T = unknown>(toolName: string, params?: T) => void;

    /**
     * Sends a link message to the host.
     * Asks the host to navigate to a URL.
     * @param url - The URL to navigate to
     */
    link: (url: string) => void;

    /**
     * Reports a size change to the host.
     * Used for auto-resizing iframes.
     * @param dimensions - The new dimensions (width and/or height)
     */
    reportSizeChange: (dimensions: { width?: number; height?: number }) => void;
}

/**
 * Hook for sending UI actions to the parent window via postMessage.
 * This is used by iframe-based UI components to communicate back to an MCP client.
 *
 * Implements the MCP-UI embeddable UI communication protocol.
 * All actions are fire-and-forget - use `useRenderData` to receive responses from the host.
 *
 * @param defaultOptions - Default options applied to all messages
 * @returns An object containing action methods:
 *   - intent: Send an intent for the host to act on
 *   - notify: Notify the host of something that happened
 *   - prompt: Ask the host to run a prompt
 *   - tool: Ask the host to run a tool call
 *   - link: Ask the host to navigate to a URL
 *   - reportSizeChange: Report iframe size changes
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { data } = useRenderData<MyData>();
 *   const { intent, tool, link } = useUIActions();
 *
 *   const handleCreateTask = () => {
 *     intent("create-task", { title: "Buy groceries" });
 *   };
 *
 *   const handleRefresh = () => {
 *     // Ask host to run a tool, host will send new data via render data
 *     tool("refresh-data", { id: data?.id });
 *   };
 *
 *   const handleOpenDocs = () => {
 *     link("https://docs.example.com");
 *   };
 *
 *   return <button onClick={handleCreateTask}>Create Task</button>;
 * }
 * ```
 */
export function useUIActions(defaultOptions?: SendMessageOptions): UseUIActionsResult {
    const targetOrigin = defaultOptions?.targetOrigin ?? "*";

    const intent = useCallback(
        <T = unknown>(intentName: string, params?: T): void => {
            window.parent.postMessage(
                {
                    type: "intent",
                    payload: {
                        intent: intentName,
                        params,
                    },
                },
                targetOrigin
            );
        },
        [targetOrigin]
    );

    const notify = useCallback(
        (message: string): void => {
            window.parent.postMessage(
                {
                    type: "notify",
                    payload: {
                        message,
                    },
                },
                targetOrigin
            );
        },
        [targetOrigin]
    );

    const prompt = useCallback(
        (promptText: string): void => {
            window.parent.postMessage(
                {
                    type: "prompt",
                    payload: {
                        prompt: promptText,
                    },
                },
                targetOrigin
            );
        },
        [targetOrigin]
    );

    const tool = useCallback(
        <T = unknown>(toolName: string, params?: T): void => {
            window.parent.postMessage(
                {
                    type: "tool",
                    payload: {
                        toolName,
                        params,
                    },
                },
                targetOrigin
            );
        },
        [targetOrigin]
    );

    const link = useCallback(
        (url: string): void => {
            window.parent.postMessage(
                {
                    type: "link",
                    payload: {
                        url,
                    },
                },
                targetOrigin
            );
        },
        [targetOrigin]
    );

    const reportSizeChange = useCallback(
        (dimensions: { width?: number; height?: number }): void => {
            window.parent.postMessage(
                {
                    type: "ui-size-change",
                    payload: dimensions,
                },
                targetOrigin
            );
        },
        [targetOrigin]
    );

    return useMemo(
        () => ({
            intent,
            notify,
            prompt,
            tool,
            link,
            reportSizeChange,
        }),
        [intent, notify, prompt, tool, link, reportSizeChange]
    );
}
