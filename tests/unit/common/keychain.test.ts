import { Keychain, redactValues, registerGlobalSecretToRedact } from "../../../src/common/keychain.js";
import type { Secret } from "../../../src/common/keychain.js";
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

describe("redactValues", () => {
    const secrets: Secret[] = [{ value: "s3cr3t-value", kind: "password" }];

    it("redacts a registered secret in a top-level string", () => {
        expect(redactValues("token is s3cr3t-value here", secrets)).not.toContain("s3cr3t-value");
    });

    it("redacts secrets in nested object string values while preserving structure", () => {
        const input = {
            a: "s3cr3t-value",
            nested: { b: "prefix s3cr3t-value suffix", c: 42 },
        };
        const result = redactValues(input, secrets) as typeof input;

        expect(result.a).not.toContain("s3cr3t-value");
        expect(result.nested.b).not.toContain("s3cr3t-value");
        expect(result.nested.c).toBe(42);
        expect(Object.keys(result)).toEqual(["a", "nested"]);
        expect(Object.keys(result.nested)).toEqual(["b", "c"]);
    });

    it("redacts secrets inside arrays", () => {
        const result = redactValues(["s3cr3t-value", "clean", { x: "s3cr3t-value" }], secrets) as [
            string,
            string,
            { x: string },
        ];

        expect(result[0]).not.toContain("s3cr3t-value");
        expect(result[1]).toBe("clean");
        expect(result[2].x).not.toContain("s3cr3t-value");
    });

    it("leaves non-string primitives untouched", () => {
        expect(redactValues(42, secrets)).toBe(42);
        expect(redactValues(true, secrets)).toBe(true);
        expect(redactValues(null, secrets)).toBe(null);
        expect(redactValues(undefined, secrets)).toBe(undefined);
    });

    it("produces output that remains valid JSON", () => {
        const input = { connectionString: "mongodb://user:s3cr3t-value@localhost:27017" };
        const output = JSON.stringify(redactValues(input, secrets));

        expect(() => {
            JSON.parse(output);
        }).not.toThrow();
        expect(output).not.toContain("s3cr3t-value");
    });
});
