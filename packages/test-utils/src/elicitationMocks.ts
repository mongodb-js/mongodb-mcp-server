import type { MockedFunction } from "vitest";
import { vi } from "vitest";

/**
 * Mock types based on the MCP SDK types, but simplified for testing.
 *
 * Values must be JSON-compatible: the v2 SDK types the `experimental` and
 * per-capability payloads of `ClientCapabilities` as nested JSON rather than
 * arbitrary objects, so the mock matches that shape.
 */
type MockJsonValue = string | number | boolean | null | MockJsonValue[] | { [key: string]: MockJsonValue };

export type MockClientCapabilities = {
    [x: string]: MockJsonValue | undefined;
    elicitation?: Record<string, MockJsonValue>;
};

export type MockElicitResult = {
    action: "accept" | "decline" | "cancel";
    content?: Record<string, unknown>;
};

/** Structural shape of a server→client `elicitation/create` request (params only). */
export type MockElicitRequest = {
    params?: {
        mode?: string;
        message?: string;
        requestedSchema?: unknown;
        [key: string]: unknown;
    };
};

/**
 * Creates a mock **client-side** `elicitation/create` handler for elicitation
 * testing.
 *
 * Protocol revision 2026-07-28 replaced push-style server→client requests with
 * multi-round-trip: a server handler returns `inputRequired(...)` and the
 * client fulfils the embedded requests through the handlers registered with
 * `setRequestHandler("elicitation/create", ...)` (auto-fulfilment on the
 * modern era; the SDK's legacy shim dispatches the same embedded requests as
 * real server→client requests on 2025-era connections). Both paths arrive at
 * the same client-side handler.
 *
 * The returned `handler` records the embedded request's params (message /
 * requestedSchema / mode) on the `mock` function and resolves with whatever
 * `confirmYes` / `confirmNo` / `acceptWith` / `cancel` / `rejectWith` last
 * configured.
 */
export function createMockElicitInput(): {
    mock: MockedFunction<(params: MockElicitRequest["params"]) => Promise<MockElicitResult>>;
    /** Client-side `elicitation/create` handler; pass to `client.setRequestHandler`. */
    handler: (request: MockElicitRequest) => Promise<MockElicitResult>;
    confirmYes: () => void;
    confirmNo: () => void;
    acceptWith: (content: Record<string, unknown> | undefined) => void;
    cancel: () => void;
    rejectWith: (error: Error) => void;
    clear: () => void;
} {
    const mockFn = vi.fn<(params: MockElicitRequest["params"]) => Promise<MockElicitResult>>();

    return {
        mock: mockFn,
        handler: async (request: MockElicitRequest): Promise<MockElicitResult> => {
            // Record the embedded request's params so tests can assert on the
            // confirmation message / schema that reached the client.
            return mockFn(request.params);
        },
        confirmYes: () =>
            mockFn.mockResolvedValue({
                action: "accept",
                content: { confirmation: "Yes" },
            }),
        confirmNo: () =>
            mockFn.mockResolvedValue({
                action: "accept",
                content: { confirmation: "No" },
            }),
        acceptWith: (content: Record<string, unknown> | undefined) =>
            mockFn.mockResolvedValue({
                action: "accept",
                content,
            }),
        cancel: () =>
            mockFn.mockResolvedValue({
                action: "cancel",
                content: undefined,
            }),
        rejectWith: (error: Error) => mockFn.mockRejectedValue(error),
        clear: () => mockFn.mockClear(),
    };
}

export function createMockGetClientCapabilities(): MockedFunction<() => MockClientCapabilities | undefined> {
    return vi.fn();
}
