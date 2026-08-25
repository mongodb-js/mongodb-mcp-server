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
     * Recursively redacts the secrets registered on this keychain - and on the root keychain,
     * which acts as a backstop for server-wide secrets - from every string reachable from
     * `value`, leaving the structure intact. Redaction is applied per-value (not on serialized
     * JSON) so it can never corrupt the resulting JSON, regardless of what the redactor
     * substitutes.
     */
    redact<T>(value: T): T {
        return redactDeep(value, this.effectiveSecrets(), new WeakSet()) as T;
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
 * their original prototype and only when a nested value actually changed - so a `Date`, `Buffer`
 * or `Map` is returned as-is rather than being flattened into a bare object, and the caller's
 * value is never mutated.
 *
 * `ancestors` tracks the objects currently being walked so a self-referencing value terminates
 * instead of recursing until the stack gives out.
 */
function redactDeep(value: unknown, secrets: Secret[], ancestors: WeakSet<object>): unknown {
    if (typeof value === "string") {
        return redactValue(value, secrets);
    }

    if (typeof value !== "object" || value === null) {
        return value;
    }

    // Hand back the original reference at the point a cycle closes. Redacting it again would not
    // reach anything new, since the value is already being walked further up the stack.
    if (ancestors.has(value)) {
        return value;
    }
    ancestors.add(value);

    try {
        if (Array.isArray(value)) {
            const items = value.map((item) => redactDeep(item, secrets, ancestors));
            return items.some((item, index) => item !== value[index]) ? items : value;
        }

        const entries = Object.entries(value);
        const redacted = entries.map(([key, entry]) => [key, redactDeep(entry, secrets, ancestors)] as const);
        if (redacted.every(([, entry], index) => entry === entries[index]?.[1])) {
            return value;
        }

        return Object.setPrototypeOf(Object.fromEntries(redacted), Object.getPrototypeOf(value) as object | null);
    } finally {
        // Only ancestors block recursion; a value referenced twice from different branches is
        // not a cycle and must still be redacted on the second visit.
        ancestors.delete(value);
    }
}

export function registerGlobalSecretToRedact(value: Secret["value"], kind: Secret["kind"]): void {
    Keychain.root.register(value, kind);
}
