import { describe, it, expect, afterEach, vi } from "vitest";
import { getRandomUUID } from "./getRandomUUID.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("getRandomUUID()", () => {
    let originalCrypto: Crypto | undefined;

    afterEach(() => {
        vi.restoreAllMocks();
        if (originalCrypto !== undefined) {
            Object.defineProperty(globalThis, "crypto", {
                value: originalCrypto,
                configurable: true,
                writable: true,
            });
            originalCrypto = undefined;
        }
    });

    it("should use Node.js crypto in normal Node.js environment", () => {
        const uuid = getRandomUUID();
        expect(uuid).toMatch(UUID_REGEX);
    });

    it("should fall back to Web Crypto API when Node.js crypto is unavailable", () => {
        vi.stubGlobal("require", (module: string) => {
            if (module === "crypto") {
                throw new Error("Cannot find module crypto");
            }
            throw new Error(`Cannot find module '${module}'`);
        });

        const uuid = getRandomUUID();
        expect(uuid).toMatch(UUID_REGEX);
    });

    it("should fall back to BSON UUID when both crypto methods are unavailable", () => {
        vi.stubGlobal("require", (module: string) => {
            if (module === "crypto") {
                throw new Error("Cannot find module crypto");
            }
            throw new Error(`Cannot find module '${module}'`);
        });

        originalCrypto = globalThis.crypto;
        Object.defineProperty(globalThis, "crypto", {
            value: undefined,
            configurable: true,
            writable: true,
        });

        const uuid = getRandomUUID();
        expect(uuid).toMatch(UUID_REGEX);
    });
});
