import { redact as redactValue } from "mongodb-redact";
import type { Secret } from "mongodb-redact";
import type { IKeychain } from "@mongodb-js/mcp-types";

export type { Secret } from "mongodb-redact";

/**
 * This class holds the secrets of a single server. Ideally, we might want to have a keychain
 * per session, but right now the loggers are set up by server and are not aware of the concept
 * of session and this would require a bigger refactor.
 *
 * Whenever we identify or create a secret (for example, Atlas login, CLI arguments...) we
 * should register them in the root Keychain (`Keychain.root.register`) or preferably
 * on the session keychain if available `this.session.keychain`.
 *
 * Secrets are never handed out: the only way to act on them is {@link Keychain.redact}, so no
 * consumer can accidentally leak them by holding onto the raw values.
 **/
export class Keychain implements IKeychain {
    private secrets: Secret[];
    private static rootKeychain: Keychain = new Keychain();

    constructor() {
        this.secrets = [];
    }

    static get root(): Keychain {
        return Keychain.rootKeychain;
    }

    register(value: Secret["value"], kind: Secret["kind"]): void {
        this.secrets.push({ value, kind });
    }

    clearAllSecrets(): void {
        this.secrets = [];
    }

    /**
     * Redacts the secrets registered on this keychain - and on the root keychain, which acts as a
     * backstop for server-wide secrets - from the strings in `value`, leaving its structure
     * intact. Redaction is applied per-value (not on serialized JSON) so it can never corrupt the
     * resulting JSON, regardless of what the redactor substitutes.
     *
     * See {@link redactDeep} for exactly what is traversed; notably `Map` and `Set` contents are
     * not.
     */
    redact<T>(value: T): T {
        return redactDeep(value, this.effectiveSecrets(), new WeakMap()) as T;
    }

    private effectiveSecrets(): Secret[] {
        const root = Keychain.rootKeychain;
        if (this === root) {
            return this.secrets;
        }

        const inherited = root.secrets.filter(
            (rootSecret) => !this.secrets.some((secret) => secret.value === rootSecret.value)
        );
        return [...this.secrets, ...inherited];
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

export function registerGlobalSecretToRedact(value: Secret["value"], kind: Secret["kind"]): void {
    Keychain.root.register(value, kind);
}
