import type { MockedFunction } from "vitest";
import { vi } from "vitest";

/**
 * Mock types based on the MCP SDK types, but simplified for testing
 */
export type MockClientCapabilities = {
    [x: string]: unknown;
    elicitation?: { [x: string]: unknown };
};

export type MockElicitInput = {
    message: string;
    requestedSchema: unknown;
};

export type MockElicitResult = {
    action: string;
    content?: {
        confirmation?: string;
    };
};

/**
 * Creates mock functions for elicitation testing
 */
export function createMockElicitInput(): {
    mock: MockedFunction<() => Promise<MockElicitResult>>;
    confirmYes: () => void;
    confirmNo: () => void;
    acceptWith: (content: { confirmation?: string } | undefined) => void;
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
        acceptWith: (content: { confirmation?: string } | undefined) =>
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
