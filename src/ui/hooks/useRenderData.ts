import { useEffect, useState } from "react";

/** Expected structure of the postMessage data from parent window */
interface RenderDataMessage {
    type: string;
    payload?: {
        renderData?: unknown;
    };
}

/** Return type for the useRenderData hook */
interface UseRenderDataResult<T> {
    data: T | null;
    isLoading: boolean;
    error: string | null;
    /** The origin of the parent window, captured from the first valid message */
    parentOrigin: string | null;
}

/**
 * Hook for receiving render data from parent window via postMessage
 * This is used by iframe-based UI components that receive data from an MCP client
 *
 * @template T - The type of data expected in the renderData payload
 * @returns An object containing:
 *   - data: The received render data (or null if not yet received)
 *   - isLoading: Whether data is still being loaded
 *   - error: Error message if message validation failed
 *   - parentOrigin: The origin of the parent window (for secure postMessage calls)
 *
 * @example
 * ```tsx
 * interface MyData {
 *   items: string[];
 * }
 *
 * function MyComponent() {
 *   const { data, isLoading, error, parentOrigin } = useRenderData<MyData>();
 *   const { intent } = useHostCommunication({ targetOrigin: parentOrigin ?? undefined });
 *   return <button onClick={() => intent("my-action")}>Click</button>;
 * }
 * ```
 */
export function useRenderData<T = unknown>(): UseRenderDataResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [parentOrigin, setParentOrigin] = useState<string | null>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent<RenderDataMessage>): void => {
            if (event.data?.type !== "ui-lifecycle-iframe-render-data") {
                // Silently ignore messages that aren't for us
                return;
            }

            setParentOrigin((current) => current ?? event.origin);

            if (!event.data.payload || typeof event.data.payload !== "object") {
                const errorMsg = "Invalid payload structure received";
                setError(errorMsg);
                setIsLoading(false);
                return;
            }

            const renderData = event.data.payload.renderData;

            if (renderData === undefined || renderData === null) {
                setIsLoading(false);
                // Not an error - parent may intentionally send null
                return;
            }

            if (typeof renderData !== "object") {
                const errorMsg = `Expected object but received ${typeof renderData}`;
                setError(errorMsg);
                setIsLoading(false);
                return;
            }

            setData(renderData as T);
            setIsLoading(false);
            setError(null);
        };

        window.addEventListener("message", handleMessage);
        window.parent.postMessage({ type: "ui-lifecycle-iframe-ready" }, "*");

        return (): void => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    return {
        data,
        isLoading,
        error,
        parentOrigin,
    };
}
