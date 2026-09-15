import { redact as redactValue } from "mongodb-redact";
import type { Secret } from "mongodb-redact";
import type { IKeychain } from "@mongodb-js/mcp-types";

export type { Secret } from "mongodb-redact";

/** The category a secret is redacted as (e.g. `password`, `mongodb uri`). */
type SecretKind = Secret["kind"];

/**
 * The shape of the secret map: keyed by the secret value, holding its kind. A
 * `Map` (rather than an array) gives O(1) dedup: the same value is never held
 * twice, and {@link Keychain.extended} is a pure merge of two maps.
 */
type SecretRecord = Map<string, { kind: SecretKind }>;

/**
 * Creates a secret map from a {@link Secret} array, deduplicating by value.
 * A value registered twice keeps its last kind.
 */
function toSecretMap(secrets: Secret[]): SecretRecord {
    const map: SecretRecord = new Map();
    for (const { value, kind } of secrets) {
        map.set(value, { kind });
    }
    return map;
}

/** Materialises the map back into the array mongodb-redact expects. */
function toSecretArray(map: SecretRecord): Secret[] {
    return [...map.entries()].map(([value, { kind }]) => ({ value, kind }));
}

/** Normalises any accepted input shape into a flat {@link Secret} array. */
function normalizeSecrets(secrets: Secret | Secret[] | Record<string, SecretKind>): Secret[] {
    if (Array.isArray(secrets)) {
        return secrets;
    }
    // A single Secret has a `value` string; a value→kind record has string keys
    // whose values are kinds. A record could technically have a key named
    // "value", so disambiguate by checking for a normal Secret shape first.
    if (typeof secrets === "object" && "value" in secrets && "kind" in secrets) {
        return [secrets as Secret];
    }
    return Object.entries(secrets).map(([value, kind]) => ({ value, kind }));
}

/**
 * An immutable, redaction-only keychain.
 *
 * A keychain is constructed once with every secret it will ever hold, and never
 * grows: there is no way to register or clear a secret after construction. To
 * redact a value against additional secrets (for example a connection-scoped
 * temporary credential), derive a copy with {@link Keychain.extended} rather
 * than mutating this one.
 *
 * Secrets are stored in a map keyed by value (each value → its kind), so a value
 * is deduplicated and lookup/merge is O(1).
 *
 * Secrets are never handed out: the only way to act on them is
 * {@link Keychain.redact}, so no consumer can accidentally leak them by holding
 * onto the raw values.
 **/
export class Keychain implements IKeychain {
    private readonly secrets: SecretRecord;

    /**
     * @param secrets - The secrets this keychain will redact, as a
     * {@link Secret} array (the config shape) or a value→kind record.
     */
    constructor(secrets: Secret[] | Record<string, SecretKind> = {}) {
        this.secrets = toSecretMap(normalizeSecrets(secrets));
    }

    /**
     * Returns a new keychain that redacts everything this one does plus the
     * given secrets. This keychain is unchanged; `extended` never mutates.
     */
    extended(additional: Secret | Secret[] | Record<string, SecretKind>): Keychain {
        const merged = new Map(this.secrets);
        for (const secret of normalizeSecrets(additional)) {
            merged.set(secret.value, { kind: secret.kind });
        }
        return new Keychain([...merged.entries()].map(([value, { kind }]) => ({ value, kind })));
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
        return redactDeep(value, toSecretArray(this.secrets), new WeakMap()) as T;
    }
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

function redactDeep(value: unknown, secrets: Secret[], redacted: WeakMap<object, unknown>): unknown {
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

    const result = redactChildren(value, secrets, redacted);
    redacted.set(value, result);
    return result;
}

function redactChildren(value: object, secrets: Secret[], redacted: WeakMap<object, unknown>): unknown {
    if (Array.isArray(value)) {
        const items = value.map((item) => redactDeep(item, secrets, redacted));
        return items.some((item, index) => item !== value[index]) ? items : value;
    }

    const entries = Object.entries(value);
    const redactedEntries = entries.map(([key, entry]) => [key, redactDeep(entry, secrets, redacted)] as const);
    if (redactedEntries.every(([, entry], index) => entry === entries[index]?.[1])) {
        return value;
    }

    return Object.setPrototypeOf(Object.fromEntries(redactedEntries), Object.getPrototypeOf(value) as object | null);
}
