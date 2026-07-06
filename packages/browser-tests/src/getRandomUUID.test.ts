import { describe, it, expect, afterEach } from "vitest";
import { getRandomUUID } from "mongodb-mcp-server/web";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("getRandomUUID() in browser environment", () => {
    let originalCrypto: Crypto | undefined;

    afterEach(() => {
        // Restore globalThis.crypto if it was modified
        if (originalCrypto !== undefined) {
            Object.defineProperty(globalThis, "crypto", {
                value: originalCrypto,
                configurable: true,
                writable: true,
            });
            originalCrypto = undefined;
        }
    });

    it("should use Web Crypto API and return a valid UUID", () => {
        // In a real browser (Chromium), require("crypto") resolves to crypto-browserify
        // which lacks randomUUID(), so getRandomUUID naturally falls back to
        // globalThis.crypto.randomUUID() — the Web Crypto API path.
        const uuid = getRandomUUID();
        expect(uuid).toMatch(UUID_REGEX);
    });

    it("should fall back to BSON UUID when globalThis.crypto is unavailable", () => {
        // Save and remove globalThis.crypto entirely so both the Node.js crypto
        // path (crypto-browserify) and Web Crypto path fail, forcing BSON UUID.
        originalCrypto = globalThis.crypto;

        Object.defineProperty(globalThis, "crypto", {
            value: undefined,
            configurable: true,
            writable: true,
        });

        const uuid = getRandomUUID();
        expect(uuid).toMatch(UUID_REGEX);
    });

    it("should fall back to BSON UUID when crypto.randomUUID is not a function", () => {
        // Keep globalThis.crypto but remove randomUUID so the Web Crypto
        // branch is skipped and BSON UUID is used instead.
        originalCrypto = globalThis.crypto;

        const cryptoWithoutRandomUUID = Object.create(globalThis.crypto) as Crypto;
        Object.defineProperty(cryptoWithoutRandomUUID, "randomUUID", {
            value: undefined,
            configurable: true,
            writable: true,
        });

        Object.defineProperty(globalThis, "crypto", {
            value: cryptoWithoutRandomUUID,
            configurable: true,
            writable: true,
        });

        const uuid = getRandomUUID();
        expect(uuid).toMatch(UUID_REGEX);
    });
});
