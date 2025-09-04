import { Keychain, registerGlobalSecretToRedact } from "../../../src/common/keychain.js";
import { describe, beforeEach, afterEach, it, expect } from "vitest";

describe("Keychain", () => {
    let keychain: Keychain;

    beforeEach(() => {
        keychain = Keychain.root;
        keychain.clearAllSecrets();
    });

    afterEach(() => {
        keychain.clearAllSecrets();
    });

    it("should register a new secret", () => {
        keychain.register("123456", "password");
        expect(keychain.allSecrets).toEqual([{ value: "123456", kind: "password" }]);
    });

    it("should remove cleared secrets", () => {
        keychain.register("123456", "password");
        expect(keychain.allSecrets).toEqual([{ value: "123456", kind: "password" }]);

        keychain.clearAllSecrets();
        keychain.register("654321", "user");
        expect(keychain.allSecrets).toEqual([{ value: "654321", kind: "user" }]);
    });

    describe("registerGlobalSecretToRedact", () => {
        it("registers the secret in the root keychain", () => {
            registerGlobalSecretToRedact("123456", "password");
            expect(keychain.allSecrets).toEqual([{ value: "123456", kind: "password" }]);
        });
    });
});
