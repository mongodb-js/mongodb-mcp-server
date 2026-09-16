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
