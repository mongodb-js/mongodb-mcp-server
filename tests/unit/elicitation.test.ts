import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
            timeoutMs: 300_000,
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

        it("should relate the elicitation to the provided request id", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.confirmYes();

            await elicitation.requestConfirmation(testMessage, { relatedRequestId: 7 });

            expect(mockElicitInput.mock).toHaveBeenCalledWith(expect.anything(), {
                timeout: 300000,
                relatedRequestId: 7,
            });
        });

        it("should use the configured timeout", async () => {
            const customElicitation = new Elicitation({
                server: {
                    getClientCapabilities: mockGetClientCapabilities,
                    elicitInput: mockElicitInput.mock,
                } as unknown as McpServer["server"],
                timeoutMs: 1_000,
            });
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.confirmYes();

            await customElicitation.requestConfirmation(testMessage);

            expect(mockElicitInput.mock).toHaveBeenCalledWith(expect.anything(), {
                timeout: 1_000,
                relatedRequestId: undefined,
            });
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

        it("should relate the elicitation to the provided request id", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.acceptWith({ username: "admin" });

            await elicitation.requestInput(testMessage, testSchema, { relatedRequestId: 7 });

            expect(mockElicitInput.mock).toHaveBeenCalledWith(expect.anything(), {
                timeout: 300000,
                relatedRequestId: 7,
            });
        });
    });

    describe("progress heartbeat", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("should send progress notifications while waiting for the user's response", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            let resolveElicitation!: (value: { action: string; content?: Record<string, unknown> }) => void;
            mockElicitInput.mock.mockReturnValue(
                new Promise((resolve) => {
                    resolveElicitation = resolve;
                })
            );
            const sendNotification = vi.fn().mockResolvedValue(undefined);

            const pending = elicitation.requestConfirmation("Confirm?", {
                progressToken: "token-1",
                sendNotification,
            });

            // An immediate heartbeat announces the wait, then one fires per interval.
            expect(sendNotification).toHaveBeenCalledTimes(1);
            expect(sendNotification).toHaveBeenCalledWith({
                method: "notifications/progress",
                params: expect.objectContaining({ progressToken: "token-1", progress: 0 }) as unknown,
            });

            await vi.advanceTimersByTimeAsync(15_000);
            expect(sendNotification).toHaveBeenCalledTimes(2);
            expect(sendNotification).toHaveBeenLastCalledWith({
                method: "notifications/progress",
                params: expect.objectContaining({ progressToken: "token-1", progress: 1 }) as unknown,
            });

            resolveElicitation({ action: "accept", content: { confirmation: "Yes" } });
            await expect(pending).resolves.toBe(true);

            // The heartbeat stops once the elicitation settles.
            await vi.advanceTimersByTimeAsync(60_000);
            expect(sendNotification).toHaveBeenCalledTimes(2);
        });

        it("should not send progress notifications without a progress token", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.confirmYes();
            const sendNotification = vi.fn().mockResolvedValue(undefined);

            await elicitation.requestConfirmation("Confirm?", { sendNotification });

            expect(sendNotification).not.toHaveBeenCalled();
        });

        it("should stop the heartbeat when the elicitation errors", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            mockElicitInput.rejectWith(new Error("Elicitation failed"));
            const sendNotification = vi.fn().mockResolvedValue(undefined);

            await expect(
                elicitation.requestConfirmation("Confirm?", { progressToken: 1, sendNotification })
            ).rejects.toThrow("Elicitation failed");

            await vi.advanceTimersByTimeAsync(60_000);
            expect(sendNotification).toHaveBeenCalledTimes(1);
        });

        it("should send progress notifications while waiting for requestInput", async () => {
            mockGetClientCapabilities.mockReturnValue({ elicitation: {} });
            let resolveElicitation!: (value: { action: string; content?: Record<string, unknown> }) => void;
            mockElicitInput.mock.mockReturnValue(
                new Promise((resolve) => {
                    resolveElicitation = resolve;
                })
            );
            const sendNotification = vi.fn().mockResolvedValue(undefined);

            const pending = elicitation.requestInput(
                "Provide details",
                {
                    type: "object",
                    properties: { username: { type: "string", title: "Username", description: "Your username" } },
                    required: ["username"],
                },
                { progressToken: 2, sendNotification }
            );

            await vi.advanceTimersByTimeAsync(15_000);
            expect(sendNotification).toHaveBeenCalledTimes(2);

            resolveElicitation({ action: "accept", content: { username: "admin" } });
            await expect(pending).resolves.toEqual({ accepted: true, fields: { username: "admin" } });

            await vi.advanceTimersByTimeAsync(60_000);
            expect(sendNotification).toHaveBeenCalledTimes(2);
        });
    });
});
