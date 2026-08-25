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
    action: string;
    content?: Record<string, unknown>;
};

/**
 * Creates mock functions for elicitation testing
 */
export function createMockElicitInput(): {
    mock: MockedFunction<() => Promise<MockElicitResult>>;
    confirmYes: () => void;
    confirmNo: () => void;
    acceptWith: (content: Record<string, unknown> | undefined) => void;
    cancel: () => void;
    rejectWith: (error: Error) => void;
    clear: () => void;
} {
    const mockFn = vi.fn();

    return {
        mock: mockFn,
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
