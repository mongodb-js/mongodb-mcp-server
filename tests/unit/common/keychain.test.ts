import { CompositeKeychain, Keychain, registerGlobalSecretToRedact } from "../../../src/common/keychain.js";
import { describe, beforeEach, afterEach, it, expect } from "vitest";

describe("Keychain", () => {
    let keychain: Keychain;

    beforeEach(() => {
        keychain = new Keychain();
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

    it("each instance has its own scope (no cross-contamination)", () => {
        const a = new Keychain();
        const b = new Keychain();
        a.register("only-in-a", "password");
        b.register("only-in-b", "password");
        expect(a.allSecrets).toEqual([{ value: "only-in-a", kind: "password" }]);
        expect(b.allSecrets).toEqual([{ value: "only-in-b", kind: "password" }]);
    });

    // Deprecated-shim tests: Keychain.root and registerGlobalSecretToRedact
    // remain functional for one release to ease the transition to
    // dependency-injected keychains. These tests guard the shim contract.
    describe("deprecated Keychain.root + registerGlobalSecretToRedact", () => {
        beforeEach(() => {
            Keychain.root.clearAllSecrets();
        });

        afterEach(() => {
            Keychain.root.clearAllSecrets();
        });

        it("registerGlobalSecretToRedact writes to the deprecated Keychain.root", () => {
            registerGlobalSecretToRedact("123456", "password");
            expect(Keychain.root.allSecrets).toEqual([{ value: "123456", kind: "password" }]);
        });

        it("Keychain.root persists across accesses (module-local fallback)", () => {
            Keychain.root.register("persist-me", "password");
            expect(Keychain.root.allSecrets).toEqual([{ value: "persist-me", kind: "password" }]);
        });
    });
});

describe("CompositeKeychain", () => {
    it("unions secrets from every delegate when read", () => {
        const bootstrap = new Keychain();
        const session = new Keychain();
        bootstrap.register("boot-secret", "password");
        session.register("session-secret", "user");

        const composite = new CompositeKeychain([session, bootstrap]);

        expect(composite.allSecrets).toEqual([
            { value: "session-secret", kind: "user" },
            { value: "boot-secret", kind: "password" },
        ]);
    });

    it("register() writes only to the first delegate", () => {
        const writable = new Keychain();
        const readOnly = new Keychain();
        const composite = new CompositeKeychain([writable, readOnly]);

        composite.register("new-secret", "password");

        expect(writable.allSecrets).toEqual([{ value: "new-secret", kind: "password" }]);
        expect(readOnly.allSecrets).toEqual([]);
    });

    it("clearAllSecrets() clears every delegate", () => {
        const a = new Keychain();
        const b = new Keychain();
        a.register("a", "password");
        b.register("b", "password");
        const composite = new CompositeKeychain([a, b]);

        composite.clearAllSecrets();

        expect(a.allSecrets).toEqual([]);
        expect(b.allSecrets).toEqual([]);
    });

    it("refuses construction with no delegates", () => {
        expect(() => new CompositeKeychain([])).toThrow(/at least one delegate/i);
    });
});
