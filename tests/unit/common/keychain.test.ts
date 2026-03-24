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

    describe("parent-child keychains", () => {
        it("child allSecrets includes parent secrets", () => {
            keychain.register("root-secret", "password");
            const child = keychain.createChild();
            child.register("child-secret", "password");

            expect(child.allSecrets).toEqual([
                { value: "root-secret", kind: "password" },
                // root-secret again because child.register propagated it to parent
                { value: "child-secret", kind: "password" },
                { value: "child-secret", kind: "password" },
            ]);
        });

        it("secrets registered on child propagate to parent", () => {
            const child = keychain.createChild();
            child.register("child-secret", "password");

            expect(keychain.allSecrets).toContainEqual({ value: "child-secret", kind: "password" });
        });

        it("clearAllSecrets on child does not affect parent", () => {
            keychain.register("root-secret", "password");
            const child = keychain.createChild();
            child.register("child-secret", "password");

            child.clearAllSecrets();
            expect(child.allSecrets).toContainEqual({ value: "root-secret", kind: "password" });
            expect(child.allSecrets).toContainEqual({ value: "child-secret", kind: "password" });
            expect(keychain.allSecrets).toContainEqual({ value: "root-secret", kind: "password" });
        });

        it("supports multi-level chains", () => {
            keychain.register("root-secret", "password");
            const child = keychain.createChild();
            const grandchild = child.createChild();
            grandchild.register("deep-secret", "password");

            const deepSecretEntries = grandchild.allSecrets.filter((s) => s.value === "deep-secret");
            expect(deepSecretEntries.length).toBeGreaterThanOrEqual(1);

            expect(keychain.allSecrets).toContainEqual({ value: "deep-secret", kind: "password" });
        });
    });
});
