import { Keychain } from "./keychain.js";
import { describe, it, expect } from "vitest";

const SECRET = "s3cr3t-value";

describe("Keychain", () => {
    it("redacts a registered secret", () => {
        const keychain = new Keychain({ [SECRET]: "password" });
        expect(keychain.redact(`token is ${SECRET} here`)).not.toContain(SECRET);
    });

    it("leaves unregistered values alone", () => {
        const keychain = new Keychain({ "some-other-secret": "password" });
        expect(keychain.redact(`token is ${SECRET} here`)).toBe(`token is ${SECRET} here`);
    });

    it("redacts nothing when constructed empty", () => {
        const keychain = new Keychain();
        expect(keychain.redact(SECRET)).toBe(SECRET);
    });

    it("redacts a value registered as a user", () => {
        const keychain = new Keychain({ [SECRET]: "user" });
        expect(keychain.redact(`user is ${SECRET}`)).toBe("user is <user>");
    });

    it("does not redact a value that is only a substring of a larger word", () => {
        // mongodb-redact matches secrets as whole words (`(?<!\w)value(?!\w)`),
        // so a registered value embedded inside a longer token is left alone rather
        // than over-redacting common substrings.
        const keychain = new Keychain({ secretpart: "password" });
        expect(keychain.redact("mysecretpartvalue")).toBe("mysecretpartvalue");
    });

    it("redacts multiple secrets", () => {
        const keychain = new Keychain({ one: "password", two: "password" });
        expect(keychain.redact("one and two")).toBe("<password> and <password>");
    });

    describe("redact", () => {
        const keychain = new Keychain({ [SECRET]: "password" });

        it("redacts secrets in nested object string values while preserving structure", () => {
            const result = keychain.redact({
                a: SECRET,
                nested: { b: `prefix ${SECRET} suffix`, c: 42 },
            });

            expect(result.a).not.toContain(SECRET);
            expect(result.nested.b).not.toContain(SECRET);
            expect(result.nested.c).toBe(42);
            expect(Object.keys(result)).toEqual(["a", "nested"]);
            expect(Object.keys(result.nested)).toEqual(["b", "c"]);
        });

        it("redacts secrets inside arrays", () => {
            const result = keychain.redact([SECRET, "clean", { x: SECRET }] as [string, string, { x: string }]);

            expect(result[0]).not.toContain(SECRET);
            expect(result[1]).toBe("clean");
            expect(result[2].x).not.toContain(SECRET);
        });

        it("leaves non-string primitives untouched", () => {
            expect(keychain.redact(42)).toBe(42);
            expect(keychain.redact(true)).toBe(true);
            expect(keychain.redact(null)).toBe(null);
            expect(keychain.redact(undefined)).toBe(undefined);
        });

        it("redacts secrets held in class instance fields", () => {
            class Credentials {
                public password = SECRET;
                public describe(): string {
                    return "credentials";
                }
            }

            const result = keychain.redact({ creds: new Credentials() });

            expect(result.creds.password).toBe("<password>");
            // The prototype survives the copy, so the value keeps behaving like an instance.
            expect(result.creds).toBeInstanceOf(Credentials);
            expect(result.creds.describe()).toBe("credentials");
        });

        it("leaves exotic objects that carry no secrets intact", () => {
            const input = {
                date: new Date("2020-01-01T00:00:00.000Z"),
                buffer: Buffer.from("hello"),
                map: new Map([["k", "v"]]),
            };
            const result = keychain.redact(input);

            expect(result.date).toBeInstanceOf(Date);
            expect(result.date.toISOString()).toBe("2020-01-01T00:00:00.000Z");
            expect(Buffer.isBuffer(result.buffer)).toBe(true);
            expect(result.buffer.toString()).toBe("hello");
            expect(result.map).toBeInstanceOf(Map);
            expect(result.map.get("k")).toBe("v");
        });

        it("does not mutate the value it is given", () => {
            const input = { creds: { password: SECRET } };
            keychain.redact(input);

            expect(input.creds.password).toBe(SECRET);
        });

        it("terminates on a self-referencing value", () => {
            const input: Record<string, unknown> = { password: SECRET };
            input.self = input;

            const result = keychain.redact(input);

            expect(result.password).toBe("<password>");
            expect(result.self).toBe(input);
        });

        it("terminates on a cycle that closes through an array", () => {
            const input: { password: string; children: unknown[] } = { password: SECRET, children: [] };
            input.children.push(input);

            const result = keychain.redact(input);

            expect(result.password).toBe("<password>");
        });

        it("redacts a value referenced twice from different branches", () => {
            const shared = { password: SECRET };
            const result = keychain.redact({ a: shared, b: shared });

            // Sharing is not a cycle: both branches must still be redacted.
            expect(result.a.password).toBe("<password>");
            expect(result.b.password).toBe("<password>");
            // ...and sharing in the input stays sharing in the output, redacted once.
            expect(result.a).toBe(result.b);
        });

        it("leaves Map and Set contents untouched", () => {
            const result = keychain.redact({ map: new Map([["k", SECRET]]), set: new Set([SECRET]) });

            // Documented limitation: their contents are not own properties, so they are not walked.
            expect(result.map.get("k")).toBe(SECRET);
            expect(result.set.has(SECRET)).toBe(true);
        });

        it("produces output that remains valid JSON", () => {
            const output = JSON.stringify(
                keychain.redact({ connectionString: `mongodb://user:${SECRET}@localhost:27017` })
            );

            expect(() => {
                JSON.parse(output);
            }).not.toThrow();
            expect(output).not.toContain(SECRET);
        });
    });
});
