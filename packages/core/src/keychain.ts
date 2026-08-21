import { redact } from "mongodb-redact";
import type { Secret } from "mongodb-redact";
export type { Secret } from "mongodb-redact";

/**
 * This class holds the secrets of a single server. Ideally, we might want to have a keychain
 * per session, but right now the loggers are set up by server and are not aware of the concept
 * of session and this would require a bigger refactor.
 *
 * Whenever we identify or create a secret (for example, Atlas login, CLI arguments...) we
 * should register them in the root Keychain (`Keychain.root.register`) or preferably
 * on the session keychain if available `this.session.keychain`.
 **/
export class Keychain {
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

    get allSecrets(): Secret[] {
        return [...this.secrets];
    }
}

export function registerGlobalSecretToRedact(value: Secret["value"], kind: Secret["kind"]): void {
    Keychain.root.register(value, kind);
}

/**
 * Recursively redacts registered secrets from every string value of a value, leaving the structure
 * intact. Redaction is applied per-value (not on serialized JSON) so it can never corrupt the
 * resulting JSON, regardless of what the redactor substitutes.
 */
export function redactValues(value: unknown, secrets: Secret[]): unknown {
    if (typeof value === "string") {
        return redact(value, secrets);
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactValues(item, secrets));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, redactValues(val, secrets)]));
    }
    return value;
}
