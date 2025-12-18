import { useCallback, useMemo } from "react";

interface SendMessageOptions {
    targetOrigin?: string;
}

/** Return type for the useHostCommunication hook */
interface UseHostCommunicationResult {
    /** Sends an intent message for the host to act on */
    intent: <T = unknown>(intent: string, params?: T) => void;
    /** Notifies the host of something that happened */
    notify: (message: string) => void;
    /** Asks the host to run a prompt */
    prompt: (prompt: string) => void;
    /** Asks the host to execute a tool */
    tool: <T = unknown>(toolName: string, params?: T) => void;
    /** Asks the host to navigate to a URL */
    link: (url: string) => void;
    /** Reports iframe size changes to the host */
    reportSizeChange: (dimensions: { width?: number; height?: number }) => void;
}

/**
 * Hook for sending UI actions to the parent window via postMessage
 * This is used by iframe-based UI components to communicate back to an MCP client
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { intent, tool, link } = useHostCommunication();
 *
 *   return <button onClick={() => intent("create-task", { title: "Buy groceries" })}>Create Task</button>;
 * }
 * ```
 */
export function useHostCommunication(defaultOptions?: SendMessageOptions): UseHostCommunicationResult {
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

