import { describe, it, expect, beforeEach } from "vitest";
import { Elicitation } from "../../src/elicitation.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockElicitInput, createMockGetClientCapabilities } from "../utils/elicitationMocks.js";

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
            expect(mockElicitInput.mock).toHaveBeenCalledWith({
                message: testMessage,
                requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
            });
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
});
