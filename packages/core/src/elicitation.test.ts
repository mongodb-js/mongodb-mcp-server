import { describe, it, expect, beforeEach, vi } from "vitest";
import { Elicitation } from "./elicitation.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MockedFunction } from "vitest";

type MockElicitResult = {
    action: string;
    content?: Record<string, unknown>;
};

type MockClientCapabilities = {
    elicitation?: Record<string, unknown>;
};

function createMockElicitInput(): {
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
        mock: mockFn as MockedFunction<() => Promise<MockElicitResult>>,
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

function createMockGetClientCapabilities(): MockedFunction<() => MockClientCapabilities | undefined> {
    return vi.fn();
}

describe("Elicitation", () => {
    let elicitation: Elicitation;
    let mockGetClientCapabilities: ReturnType<typeof createMockGetClientCapabilities>;
    let mockElicitInput: ReturnType<typeof createMockElicitInput>;

    beforeEach(() => {
        mockGetClientCapabilities = createMockGetClientCapabilities();
        mockElicitInput = createMockElicitInput();
        elicitation = new Elicitation({
            server: {
                getClientCapabilities: mockGetClientCapabilities,
                elicitInput: mockElicitInput.mock,
            } as unknown as McpServer["server"],
        });
    });

    describe("supportsElicitation", () => {
        it("should return true when client supports elicitation", () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });

            const result = elicitation.supportsElicitation();

            expect(result).toBe(true);
            expect(mockGetClientCapabilities).toHaveBeenCalledTimes(1);
        });

        it("should return false when client does not support elicitation", () => {
            mockGetClientCapabilities.mockReturnValue({});

            const result = elicitation.supportsElicitation();

            expect(result).toBe(false);
            expect(mockGetClientCapabilities).toHaveBeenCalledTimes(1);
        });

        it("should return false when client capabilities are undefined", () => {
            mockGetClientCapabilities.mockReturnValue(undefined);

            const result = elicitation.supportsElicitation();

            expect(result).toBe(false);
            expect(mockGetClientCapabilities).toHaveBeenCalledTimes(1);
        });

        it("should return false when elicitation capability is explicitly undefined", () => {
            mockGetClientCapabilities.mockReturnValue(undefined);

            const result = elicitation.supportsElicitation();

            expect(result).toBe(false);
            expect(mockGetClientCapabilities).toHaveBeenCalledTimes(1);
        });
    });

    describe("requestConfirmation", () => {
        const testMessage = "Are you sure you want to proceed?";

        it("should return true when client does not support elicitation", async () => {
            mockGetClientCapabilities.mockReturnValue({});

            const result = await elicitation.requestConfirmation(testMessage);

            expect(result).toBe(true);
            expect(mockGetClientCapabilities).toHaveBeenCalledTimes(1);
            expect(mockElicitInput.mock).not.toHaveBeenCalled();
        });

        it("should return true when user confirms with 'Yes' and action is 'accept'", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.confirmYes();

            const result = await elicitation.requestConfirmation(testMessage);

            expect(result).toBe(true);
            expect(mockGetClientCapabilities).toHaveBeenCalledTimes(1);
            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
            expect(mockElicitInput.mock).toHaveBeenCalledWith(
                {
                    message: testMessage,
                    requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                    mode: "form",
                },
                { timeout: 300000 }
            );
        });

        it("should return false when user selects 'No' with action 'accept'", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.confirmNo();

            const result = await elicitation.requestConfirmation(testMessage);

            expect(result).toBe(false);
            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
        });

        it("should return false when content is undefined", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.acceptWith(undefined);

            const result = await elicitation.requestConfirmation(testMessage);

            expect(result).toBe(false);
            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
        });

        it("should return false when confirmation field is missing", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.acceptWith({});

            const result = await elicitation.requestConfirmation(testMessage);

            expect(result).toBe(false);
            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
        });

        it("should return false when user cancels", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.cancel();

            const result = await elicitation.requestConfirmation(testMessage);

            expect(result).toBe(false);
            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
        });

        it("should handle elicitInput erroring", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            const error = new Error("Elicitation failed");
            mockElicitInput.rejectWith(error);

            await expect(elicitation.requestConfirmation(testMessage)).rejects.toThrow("Elicitation failed");
            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
        });
    });

    describe("requestInput", () => {
        const testMessage = "Please provide connection details.";
        const testSchema = {
            type: "object" as const,
            properties: {
                username: { type: "string" as const, title: "Username", description: "Your username" },
                password: { type: "string" as const, title: "Password", description: "Your password" },
            },
            required: ["username", "password"],
        };

        it("should return accepted:false when client does not support elicitation", async () => {
            mockGetClientCapabilities.mockReturnValue({});

            const result = await elicitation.requestInput(testMessage, testSchema);

            expect(result).toEqual({ accepted: false });
            expect(mockElicitInput.mock).not.toHaveBeenCalled();
        });

        it("should return accepted:true with fields when user accepts", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.acceptWith({ username: "admin", password: "secret" });

            const result = await elicitation.requestInput(testMessage, testSchema);

            expect(result).toEqual({ accepted: true, fields: { username: "admin", password: "secret" } });
            expect(mockElicitInput.mock).toHaveBeenCalledWith(
                { mode: "form", message: testMessage, requestedSchema: testSchema },
                { timeout: 300000 }
            );
        });

        it("should return accepted:false when user cancels", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.cancel();

            const result = await elicitation.requestInput(testMessage, testSchema);

            expect(result).toEqual({ accepted: false });
        });

        it("should return accepted:false when action is not accept", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.mock.mockResolvedValue({ action: "decline", content: undefined });

            const result = await elicitation.requestInput(testMessage, testSchema);

            expect(result).toEqual({ accepted: false });
        });

        it("should return accepted:false when content is undefined", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.acceptWith(undefined);

            const result = await elicitation.requestInput(testMessage, testSchema);

            expect(result).toEqual({ accepted: false });
        });

        it("should filter out non-string field values", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.acceptWith({ username: "admin", count: 42, flag: true });

            const result = await elicitation.requestInput(testMessage, testSchema);

            expect(result).toEqual({ accepted: true, fields: { username: "admin" } });
        });

        it("should handle elicitInput erroring", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            const error = new Error("Input failed");
            mockElicitInput.rejectWith(error);

            await expect(elicitation.requestInput(testMessage, testSchema)).rejects.toThrow("Input failed");
        });
    });
});
