import { STREAMS_PASSWORD_PROPERTIES } from "./openapiPasswordKeys.generated.js";

/**
 * Property names the Stream Processing schemas of the Atlas Admin API
 * OpenAPI spec mark `Format: password` (see
 * `packages/atlas-api-client/openapi.d.ts`). The spec is the source of truth
 * for what counts as a secret on this surface, so these are redacted on top
 * of the curated `SECRET_KEYS` list below. The set is generated from the
 * spec by `packages/scripts/src/generatePasswordKeys.ts` as part of
 * `packages/scripts/generate.sh`, so when the spec changes, redaction
 * follows the regeneration (e.g. `sslKey`, marked `password` in July 2025).
 *
 * `redactSensitiveKeys.test.ts` re-derives the password-format names of
 * Streams schemas from `openapi.d.ts` and fails when that file was
 * regenerated without the key generator, or when a generated key is not
 * redacted.
 */
const GENERATED_SENSITIVE_KEYS = new Set(STREAMS_PASSWORD_PROPERTIES.map((key) => key.toLowerCase()));

/**
 * Secret-valued object keys that must never surface in tool output. These are
 * the keys (matched case-insensitively, recursively) whose *values* are secrets
 * — as opposed to the surrounding auth metadata (`authentication.username`,
 * `authentication.mechanism`, `bootstrapServers`, `clusterName`) which IS useful
 * to the agent and stays intact.
 *
 * The set is curated because a broad `.*key$`/`.*secret$` match would clobber
 * legitimate non-secret fields (e.g. `clientId`, `publicKey`, `certificate`,
 * `ssh`).
 */
const SECRET_KEYS = new Set([
    "password",
    "saslpassword",
    "apikey",
    "accesstoken",
    "token",
    "clientsecret",
    "secret",
    "privatekey",
    "sslclientauthenticationkey",
    "sslkeypassword",
    "awssecretaccesskey",
    "oidcclientsecret",
    "sharedsecret",
    // Header names whose values are secrets (an `Authorization`/`X-Api-Key`
    // value is auth config, never useful to the agent).
    "authorization",
    "proxy-authorization",
    "api-key",
    "x-api-key",
]);

/** Whether a given object key holds a secret and must be masked. */
function isSecretKey(key: string): boolean {
    const lowered = key.toLowerCase();
    return SECRET_KEYS.has(lowered) || GENERATED_SENSITIVE_KEYS.has(lowered);
}

/**
 * Recursively masks the *values* of secret-valued keys in `value`, returning a
 * copy with the same structure. Non-secret keys (and all non-object values) are
 * left untouched, so useful auth metadata survives. Returns a new value; the
 * input is never mutated.
 */
export function redactSensitiveKeys<T>(value: T): T {
    return walk(value) as T;
}

function walk(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => walk(item));
    }

    if (value !== null && typeof value === "object") {
        // `Object.fromEntries` uses CreateDataProperty, so a source key of
        // `__proto__` becomes an own key rather than setting the prototype.
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
                key,
                isSecretKey(key) ? "<redacted>" : walk(entry),
            ])
        );
    }

    return value;
}
