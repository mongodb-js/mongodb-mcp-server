import type { Secret } from "mongodb-redact";
export type { Secret } from "mongodb-redact";

/**
 * Holds secrets for redaction in logging and telemetry pipelines.
 *
 * Keychains form a parent-child hierarchy:
 * - `Keychain.root` stores base config secrets (registered during config parsing).
 * - Each session creates a child via `Keychain.root.createChild()` to hold
 *   session-specific secrets (e.g. generated credentials, config override values).
 *
 * `allSecrets` aggregates secrets from the entire parent chain so that redaction
 * covers both global and session-scoped values.
 *
 * When a secret is registered on a child keychain it is also propagated to the
 * parent so that shared loggers (ConsoleLogger, DiskLogger) — which reference
 * the root keychain — can redact session-specific secrets as well.
 **/
export class Keychain {
    private secrets: Secret[];
    private static rootKeychain: Keychain = new Keychain();
    private readonly parent?: Keychain;

    constructor(parent?: Keychain) {
        this.secrets = [];
        this.parent = parent;
    }

    static get root(): Keychain {
        return Keychain.rootKeychain;
    }

    /**
     * Creates a child keychain whose `allSecrets` includes this keychain's
     * secrets. Secrets registered on the child also propagate upward so
     * shared loggers that reference an ancestor still redact them.
     */
    createChild(): Keychain {
        return new Keychain(this);
    }

    register(value: Secret["value"], kind: Secret["kind"]): void {
        this.secrets.push({ value, kind });
        this.parent?.register(value, kind);
    }

    clearAllSecrets(): void {
        this.secrets = [];
    }

    get allSecrets(): Secret[] {
        const parentSecrets = this.parent?.allSecrets ?? [];
        return [...parentSecrets, ...this.secrets];
    }
}

export function registerGlobalSecretToRedact(value: Secret["value"], kind: Secret["kind"]): void {
    Keychain.root.register(value, kind);
}
