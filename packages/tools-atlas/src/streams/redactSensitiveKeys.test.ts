import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { redactSensitiveKeys } from "./redactSensitiveKeys.js";

describe("redactSensitiveKeys", () => {
    it("masks secret-valued keys but keeps location/state/auth metadata intact", () => {
        const input = {
            name: "kafka-in",
            type: "Kafka",
            state: "READY",
            region: "us-east-1",
            bootstrapServers: "broker:9092",
            authentication: {
                mechanism: "SASL_SCRAM",
                username: "svc-user",
                password: "s3cr3t-pass",
                saslOauthbearerSettings: { tokenEndpointUrl: "https://idp.example.com/token", clientId: "cid" },
            },
            ssl: {
                sslClientAuthenticationKey: "-----BEGIN PRIVATE KEY-----",
                sslKeyPassword: "key-pass",
                certificate: "-----BEGIN CERTIFICATE-----",
            },
        };

        const redacted = redactSensitiveKeys(input);

        // Secret values are masked.
        expect(JSON.stringify(redacted)).not.toContain("s3cr3t-pass");
        expect(JSON.stringify(redacted)).not.toContain("-----BEGIN PRIVATE KEY-----");
        expect(JSON.stringify(redacted)).not.toContain("key-pass");

        // Useful non-secret metadata survives.
        expect(redacted.name).toBe("kafka-in");
        expect(redacted.type).toBe("Kafka");
        expect(redacted.region).toBe("us-east-1");
        expect(redacted.bootstrapServers).toBe("broker:9092");
        expect(redacted.authentication.mechanism).toBe("SASL_SCRAM");
        expect(redacted.authentication.username).toBe("svc-user");
        // Nested non-secret fields survive, while nested secrets are masked.
        expect(redacted.authentication.saslOauthbearerSettings.tokenEndpointUrl).toBe("https://idp.example.com/token");
        expect(redacted.authentication.saslOauthbearerSettings.clientId).toBe("cid");
        expect(redacted.ssl.certificate).toBe("-----BEGIN CERTIFICATE-----");
    });

    it("does not clobber username/clientId/certificate/publicKey (only secrets)", () => {
        const input = {
            username: "alice",
            clientId: "cid-123",
            certificate: "cert",
            publicKey: "pub",
            mechanism: "OAUTHBEARER",
        };
        const redacted = redactSensitiveKeys(input);
        expect(redacted).toEqual(input);
    });

    it("recurses into arrays and does not mutate the input", () => {
        const input = {
            connections: [
                { name: "a", password: "p1" },
                { name: "b", password: "p2" },
            ],
        };
        const copy = structuredClone(input);
        const redacted = redactSensitiveKeys(input);

        expect(JSON.stringify(redacted)).not.toContain("p1");
        expect(JSON.stringify(redacted)).not.toContain("p2");
        expect(redacted.connections).toHaveLength(2);
        // The original is unchanged.
        expect(input).toEqual(copy);
    });

    it("leaves scalars and non-object values untouched", () => {
        expect(redactSensitiveKeys("hello")).toBe("hello");
        expect(redactSensitiveKeys(42)).toBe(42);
        expect(redactSensitiveKeys(null)).toBe(null);
        expect(redactSensitiveKeys(undefined)).toBe(undefined);
    });

    it("masks the values of sensitive HTTP header names (e.g. Authorization, X-Api-Key)", () => {
        const input = {
            type: "Https",
            url: "https://example.com",
            headers: {
                Authorization: "Bearer super-secret-token",
                "X-Api-Key": "api-key-123",
                "Content-Type": "application/json",
            },
        };

        const redacted = redactSensitiveKeys(input);

        expect(JSON.stringify(redacted)).not.toContain("super-secret-token");
        expect(JSON.stringify(redacted)).not.toContain("api-key-123");
        // Non-sensitive header names survive.
        expect(redacted.headers["Content-Type"]).toBe("application/json");
        expect(redacted.headers.Authorization).toBe("<redacted>");
        expect(redacted.headers["X-Api-Key"]).toBe("<redacted>");
    });

    it("masks authentication.sslKey (a private key marked `Format: password` in the OpenAPI spec)", () => {
        const input = {
            name: "kafka-in",
            type: "Kafka",
            authentication: {
                mechanism: "PLAIN",
                username: "svc-user",
                sslCertificate: "-----BEGIN CERTIFICATE-----",
                sslKey: "-----BEGIN PRIVATE KEY-----",
                sslKeyPassword: "key-pass",
            },
        };

        const redacted = redactSensitiveKeys(input);

        expect(JSON.stringify(redacted)).not.toContain("-----BEGIN PRIVATE KEY-----");
        expect(redacted.authentication.sslKey).toBe("<redacted>");
        // Neighbouring non-secret fields survive.
        expect(redacted.authentication.username).toBe("svc-user");
        expect(redacted.authentication.sslCertificate).toBe("-----BEGIN CERTIFICATE-----");
    });

    it("covers every password-format field of Streams schemas in the Atlas OpenAPI spec", () => {
        // Extract the property names the Streams* schemas of the Atlas Admin
        // API spec mark `Format: password` from the generated types, so
        // redaction cannot silently drift when the spec changes.
        const specPath = new URL("../../../atlas-api-client/openapi.d.ts", import.meta.url);
        const lines = readFileSync(specPath, "utf8").split(/\r?\n/);
        const passwordKeys = new Set<string>();
        let schemaName = "";
        let unresolved = 0;
        for (let i = 0; i < lines.length; i++) {
            const schemaHeader = lines[i]?.match(/^ {8}(\w+): \{$/);
            if (schemaHeader) {
                schemaName = schemaHeader[1] as string;
                continue;
            }
            if (!lines[i]?.includes("Format: password") || !schemaName.startsWith("Streams")) {
                continue;
            }
            // Every "Format: password" occurrence must resolve to a property
            // within its own jsdoc block (bounded look-ahead): an unbounded
            // scan could silently skip a real password field whose rendering
            // changed and grab an unrelated property from the next schema.
            const lookAhead = lines.slice(i + 1, i + 6);
            const match = lookAhead
                .map((line) => line?.match(/^ {12}(\w+)\??: /))
                .find((match): match is RegExpMatchArray => match !== null);
            if (match?.[1] !== undefined) {
                passwordKeys.add(match[1]);
            } else {
                unresolved++;
            }
        }
        expect(unresolved, "every 'Format: password' occurrence must resolve to a property").toBe(0);
        expect(passwordKeys.size).toBeGreaterThan(0);

        // Every spec-derived name must be masked: if one is missing from
        // SECRET_KEYS in redactSensitiveKeys.ts, this fails with its name.
        for (const key of passwordKeys) {
            const redacted = redactSensitiveKeys({ [key]: "super-secret" });
            expect(
                redacted[key],
                `"${key}" is marked Format: password in the OpenAPI spec; add it to SECRET_KEYS in redactSensitiveKeys.ts`
            ).toBe("<redacted>");
        }
    });

    it("still redacts every key the curated list has always covered", () => {
        // Regression pin: the curated list must survive the spec-derived set
        // unchanged. If a key here stops being redacted, either restore it
        // to SECRET_KEYS or consciously remove it from this list with a
        // reason.
        const curatedKeys = [
            "password",
            "saslPassword",
            "apiKey",
            "accessToken",
            "token",
            "clientSecret",
            "secret",
            "privateKey",
            "sslClientAuthenticationKey",
            "sslKeyPassword",
            "awsSecretAccessKey",
            "oidcClientSecret",
            "sharedSecret",
            // Header names whose values are secrets.
            "Authorization",
            "Proxy-Authorization",
            "api-key",
            "X-Api-Key",
        ];

        for (const key of curatedKeys) {
            const redacted = redactSensitiveKeys({ [key]: "super-secret" });
            expect(redacted[key], `pre-existing key "${key}" must stay redacted`).toBe("<redacted>");
        }
    });

    it("redacts the spec-derived keys beyond the curated list", () => {
        // The delta the spec scan adds over the pre-existing curated names.
        // This list grows when the Atlas spec marks new fields
        // `Format: password`.
        const specDerivedKeysToPin = ["sslKey"];

        for (const key of specDerivedKeysToPin) {
            const redacted = redactSensitiveKeys({ [key]: "super-secret" });
            expect(redacted[key], `spec-derived key "${key}" must be redacted`).toBe("<redacted>");
        }
    });

    it("turns a source `__proto__` key into an own key instead of setting the prototype", () => {
        // Simulate an object whose own enumerable key is `__proto__` (as a
        // credential value used as a key could be). The rebuilt object must not
        // inherit a mutated prototype.
        const input = JSON.parse('{"__proto__": "s3cr3t", "name": "x"}') as Record<string, unknown>;
        const redacted = redactSensitiveKeys(input);

        expect(Object.prototype.hasOwnProperty.call(redacted, "__proto__")).toBe(true);
        expect(Object.getOwnPropertyDescriptor(redacted, "__proto__")?.value).toBe("s3cr3t");
        // The object still has the normal prototype; nothing was polluted.
        expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
        expect(redacted.name).toBe("x");
    });
});
