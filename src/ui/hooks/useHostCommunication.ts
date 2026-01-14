import { useCallback } from "react";
import {
    postUIActionResult,
    uiActionResultIntent,
    uiActionResultNotification,
    uiActionResultPrompt,
    uiActionResultToolCall,
    uiActionResultLink,
} from "@mcp-ui/server";

/** Return type for the useHostCommunication hook */
interface UseHostCommunicationResult {
    /** Sends an intent message for the host to act on */
    intent: typeof uiActionResultIntent;
    /** Notifies the host of something that happened */
    notify: typeof uiActionResultNotification;
    /** Asks the host to run a prompt */
    prompt: typeof uiActionResultPrompt;
    /** Asks the host to execute a tool */
    tool: typeof uiActionResultToolCall;
    /** Asks the host to navigate to a URL */
    link: typeof uiActionResultLink;
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
export function useHostCommunication(): UseHostCommunicationResult {
    const intent: typeof uiActionResultIntent = useCallback((...args) => {
        const result = uiActionResultIntent(...args);
        postUIActionResult(result);
        return result;
    }, []);

    const notify: typeof uiActionResultNotification = useCallback((...args) => {
        const result = uiActionResultNotification(...args);
        postUIActionResult(result);
        return result;
    }, []);

    const prompt: typeof uiActionResultPrompt = useCallback((...args) => {
        const result = uiActionResultPrompt(...args);
        postUIActionResult(result);
        return result;
    }, []);

    const tool: typeof uiActionResultToolCall = useCallback((...args) => {
        const result = uiActionResultToolCall(...args);
        postUIActionResult(result);
        return result;
    }, []);

    const link: typeof uiActionResultLink = useCallback((...args) => {
        const result = uiActionResultLink(...args);
        postUIActionResult(result);
        return result;
    }, []);

    return {
        intent,
        notify,
        prompt,
        tool,
        link,
    };
}
