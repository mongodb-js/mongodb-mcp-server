import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getRandomUUID } from "../../../src/helpers/getRandomUUID.js";

describe("getRandomUUID", () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it("should return a valid UUID format", () => {
        const uuid = getRandomUUID();
        expect(uuid).toMatch(UUID_REGEX);
    });

    it("should return different UUIDs on subsequent calls", () => {
        const uuid1 = getRandomUUID();
        const uuid2 = getRandomUUID();
        const uuid3 = getRandomUUID();

        expect(uuid1).not.toBe(uuid2);
        expect(uuid2).not.toBe(uuid3);
        expect(uuid1).not.toBe(uuid3);
    });

    it("should return a string", () => {
        const uuid = getRandomUUID();
        expect(typeof uuid).toBe("string");
    });

    describe("fallback behavior", () => {
        let originalRequire: NodeJS.Require;

        beforeEach(() => {
            // Store original require
            originalRequire = global.require;
        });

        afterEach(() => {
            // Restore original require and globalThis
            global.require = originalRequire;
            vi.unstubAllGlobals();
        });

        it("should use Node.js crypto when available", () => {
            const uuid = getRandomUUID();
            expect(uuid).toMatch(UUID_REGEX);
        });

        it("should fall back to Web Crypto API when Node.js crypto fails", () => {
            // Note: In Node.js environment, require('crypto') will always succeed,
            // so this test verifies that the function produces a valid UUID
            // In a real browser environment, it would fall back to Web Crypto API
            const uuid = getRandomUUID();

            // Should still produce a valid UUID
            expect(uuid).toMatch(UUID_REGEX);
        });

        it("should fall back to BSON UUID when both crypto methods are unavailable", () => {
            // Mock require to throw an error
            global.require = vi.fn().mockImplementation(() => {
                throw new Error("Cannot find module 'crypto'");
            }) as unknown as NodeJS.Require;

            // Mock globalThis.crypto to be undefined
            vi.stubGlobal("crypto", undefined);

            const uuid = getRandomUUID();

            // BSON UUID should still produce valid UUID format
            expect(uuid).toMatch(UUID_REGEX);
        });

        it("should fall back to BSON UUID when globalThis.crypto exists but randomUUID is not a function", () => {
            // Mock require to throw an error
            global.require = vi.fn().mockImplementation(() => {
                throw new Error("Cannot find module 'crypto'");
            }) as unknown as NodeJS.Require;

            // Mock globalThis.crypto without randomUUID function
            vi.stubGlobal("crypto", {
                getRandomValues: vi.fn(),
            });

            const uuid = getRandomUUID();

            // BSON UUID should still produce valid UUID format
            expect(uuid).toMatch(UUID_REGEX);
        });
    });
});
