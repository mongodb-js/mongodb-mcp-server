import { redact as redactValue } from "mongodb-redact";
import type { Secret } from "mongodb-redact";
import type { IKeychain } from "@mongodb-js/mcp-types";

export type { Secret } from "mongodb-redact";

/** The category a secret is redacted as (e.g. `password`, `mongodb uri`). */
export type SecretKind = Secret["kind"];

/** The map of secret value → kind. */
type SecretRecord = Record<string, SecretKind>;

/**
 * An immutable, redaction-only keychain.
 *
 * A keychain is constructed once with every secret it will ever hold, and never
 * grows: there is no way to register or clear a secret after construction.
 *
 * Secrets are keyed by value (each value → its kind), so a value is
 * deduplicated and lookup is O(1).
 *
 * Secrets are never handed out: the only way to act on them is
 * {@link Keychain.redact}, so no consumer can accidentally leak them by holding
 * onto the raw values.
 **/
export class Keychain implements IKeychain {
    private readonly secrets: Readonly<SecretRecord>;

    /**
     * @param secrets - The secrets this keychain will redact, as a value→kind
     * record (e.g. `{ "s3cr3t": "password" }`).
     */
    constructor(secrets: SecretRecord = {}) {
        // Clone and freeze so a caller holding the record can't mutate the
        // keychain after construction (it must stay immutable).
        this.secrets = Object.freeze({ ...secrets });
    }

    /**
     * Redacts the secrets on this keychain from the strings in `value`, leaving
     * its structure intact. Redaction is applied per-value (not on serialized
     * JSON) so it can never corrupt the resulting JSON, regardless of what the
     * redactor substitutes.
     *
     * See {@link redactDeep} for exactly what is traversed; notably `Map` and
     * `Set` contents are not.
     */
    redact<T>(value: T): T {
        return redactDeep({ value, secrets: toSecretArray(this.secrets), redacted: new WeakMap() }) as T;
    }

    /**
     * Returns the message of an error (or the string form of a non-error) with
     * this keychain's secrets redacted, safe to log or surface to a user.
     */
    redactErrorMessage(error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        return this.redact(message);
    }
}

/** Converts the value→kind record into the array mongodb-redact expects. */
function toSecretArray(secrets: Readonly<SecretRecord>): Secret[] {
    return Object.entries(secrets).map(([value, kind]) => ({ value, kind }));
}

/**
 * Recursively redacts `secrets` from the strings in `value`.
 *
 * mongodb-redact's own `redact` only descends into plain objects and arrays, so a secret held in
 * a class instance field would survive it. This walks non-plain objects too, but rebuilds them on
 * their original prototype and only when a nested value actually changed - so a `Date` or `Buffer`
 * is returned as-is rather than being flattened into a bare object, and the caller's value is
 * never mutated.
 *
 * Only arrays and own enumerable properties are visited. Collections that keep their contents
 * behind an API rather than in properties - `Map`, `Set`, and anything similar - are returned
 * untouched, so a secret stored as a `Map` value or `Set` member is *not* redacted.
 *
 * `redacted` memoizes the walk for the duration of one top-level call: a value reachable by more
 * than one path is redacted once and the same copy is reused, so sharing in the input is still
 * sharing in the output. While a value is being walked it maps to {@link inProgress}, which is how
 * a cycle is detected - there is no redacted copy to hand back yet, so the cycle closes on the
 * original value.
 */
const inProgress = Symbol("redactDeep.inProgress");

function redactDeep({
    value,
    secrets,
    redacted,
}: {
    value: unknown;
    secrets: Secret[];
    redacted: WeakMap<object, unknown>;
}): unknown {
    if (typeof value === "string") {
        return redactValue(value, secrets);
    }

    if (typeof value !== "object" || value === null) {
        return value;
    }

    if (redacted.has(value)) {
        const previous = redacted.get(value);
        return previous === inProgress ? value : previous;
    }
    redacted.set(value, inProgress);

    const result = redactChildren({ value, secrets, redacted });
    redacted.set(value, result);
    return result;
}

function redactChildren({
    value,
    secrets,
    redacted,
}: {
    value: object;
    secrets: Secret[];
    redacted: WeakMap<object, unknown>;
}): unknown {
    if (Array.isArray(value)) {
        const items = value.map((item) => redactDeep({ value: item, secrets, redacted }));
        return items.some((item, index) => item !== value[index]) ? items : value;
    }

    const entries = Object.entries(value);
    const redactedEntries = entries.map(
        ([key, entry]) => [key, redactDeep({ value: entry, secrets, redacted })] as const
    );
    if (redactedEntries.every(([, entry], index) => entry === entries[index]?.[1])) {
        return value;
    }

    return Object.setPrototypeOf(Object.fromEntries(redactedEntries), Object.getPrototypeOf(value) as object | null);
}
