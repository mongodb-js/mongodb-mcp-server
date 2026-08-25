import { describe, it, expect, beforeEach, vi } from "vitest";
import { Elicitation, CONFIRMATION_INPUT_KEY } from "./elicitation.js";
import type { McpServer } from "@modelcontextprotocol/server";
import type { MockedFunction } from "vitest";

type MockClientCapabilities = {
    elicitation?: Record<string, unknown>;
};

function createMockGetClientCapabilities(): MockedFunction<() => MockClientCapabilities | undefined> {
    return vi.fn();
}

describe("Elicitation (multi-round-trip builders/readers)", () => {
    let elicitation: Elicitation;
    let mockGetClientCapabilities: ReturnType<typeof createMockGetClientCapabilities>;

    beforeEach(() => {
        mockGetClientCapabilities = createMockGetClientCapabilities();
        elicitation = new Elicitation({
            server: {
                getClientCapabilities: mockGetClientCapabilities,
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
        });

        it("should return false when client capabilities are undefined", () => {
            mockGetClientCapabilities.mockReturnValue(undefined);

            const result = elicitation.supportsElicitation();

            expect(result).toBe(false);
        });
    });

    describe("confirmationRequired", () => {
        it("builds an inputRequired result embedding the confirmation elicitation", () => {
            const result = elicitation.confirmationRequired("Are you sure?");

            expect(result.resultType).toBe("input_required");
            expect(result.inputRequests).toBeDefined();
            const request = result.inputRequests?.[CONFIRMATION_INPUT_KEY];
            expect(request).toBeDefined();
            expect(request?.method).toBe("elicitation/create");
            const params = request?.params as { mode: string; message: string; requestedSchema: unknown };
            expect(params.mode).toBe("form");
            expect(params.message).toBe("Are you sure?");
            expect(params.requestedSchema).toEqual(Elicitation.CONFIRMATION_SCHEMA);
        });
    });

    describe("readConfirmation", () => {
        it("returns undefined when there are no inputResponses (first entry)", () => {
            expect(elicitation.readConfirmation(undefined)).toBeUndefined();
        });

        it("returns undefined when the key is missing from inputResponses", () => {
            expect(elicitation.readConfirmation({})).toBeUndefined();
        });

        it("returns true when the user accepted with 'Yes'", () => {
            expect(
                elicitation.readConfirmation({ [CONFIRMATION_INPUT_KEY]: { action: "accept", content: { confirmation: "Yes" } } })
            ).toBe(true);
        });

        it("returns false when the user answered 'No'", () => {
            expect(
                elicitation.readConfirmation({ [CONFIRMATION_INPUT_KEY]: { action: "accept", content: { confirmation: "No" } } })
            ).toBe(false);
        });

        it("returns undefined when the user declined", () => {
            expect(elicitation.readConfirmation({ [CONFIRMATION_INPUT_KEY]: { action: "decline" } })).toBeUndefined();
        });

        it("returns false when the content is missing the confirmation field", () => {
            expect(elicitation.readConfirmation({ [CONFIRMATION_INPUT_KEY]: { action: "accept", content: {} } })).toBe(
                false
            );
        });
    });

    describe("inputRequired", () => {
        const testMessage = "Please provide connection details.";
        const testSchema = {
            type: "object" as const,
            properties: {
                username: { type: "string" as const, title: "Username", description: "Your username" },
                password: { type: "string" as const, title: "Password", description: "Your password" },
            },
            required: ["username", "password"],
        };

        it("builds an inputRequired result keyed by the provided key", () => {
            const result = elicitation.inputRequired("connection-fields", testMessage, testSchema);

            expect(result.resultType).toBe("input_required");
            const params = result.inputRequests?.["connection-fields"]?.params as {
                mode: string;
                message: string;
                requestedSchema: unknown;
            };
            expect(params.mode).toBe("form");
            expect(params.message).toBe(testMessage);
            expect(params.requestedSchema).toEqual(testSchema);
        });
    });

    describe("readInput", () => {
        const schema = {
            type: "object" as const,
            properties: { username: { type: "string" as const, title: "Username", description: "Your username" } },
            required: ["username"],
        };
        const key = "connection-fields";

        it("returns undefined when there are no inputResponses (first entry)", () => {
            expect(elicitation.readInput(undefined, key)).toBeUndefined();
        });

        it("returns accepted:true with fields when the user accepts", () => {
            expect(
                elicitation.readInput({ [key]: { action: "accept", content: { username: "admin", password: "secret" } } }, key)
            ).toEqual({ accepted: true, fields: { username: "admin", password: "secret" } });
        });

        it("returns accepted:false when the user declines or cancels", () => {
            expect(elicitation.readInput({ [key]: { action: "decline" } }, key)).toEqual({ accepted: false });
            expect(elicitation.readInput({ [key]: { action: "cancel" } }, key)).toEqual({ accepted: false });
        });

        it("filters out non-string field values", () => {
            expect(
                elicitation.readInput({ [key]: { action: "accept", content: { username: "admin", count: 42, flag: true } } }, key)
            ).toEqual({ accepted: true, fields: { username: "admin" } });
        });
    });
});
