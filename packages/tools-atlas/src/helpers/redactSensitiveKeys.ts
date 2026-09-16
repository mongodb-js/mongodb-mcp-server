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
]);

/** Whether a given object key holds a secret and must be masked. */
function isSecretKey(key: string): boolean {
    return SECRET_KEYS.has(key.toLowerCase());
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
        const result: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            result[key] = isSecretKey(key) ? "<redacted>" : walk(entry);
        }
        return result;
    }

    return value;
}
