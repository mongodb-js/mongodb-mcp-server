import type { Secret } from "mongodb-redact";

export type { Secret } from "mongodb-redact";

/**
 * Holds the secrets to be redacted from log output and other server-side
 * messages. A keychain instance is normally scoped to a single server but
 * implementations may also expose a per-session keychain.
 */
export interface IKeychain {
    /**
     * Registers a value as a secret of the given kind so that it will be
     * redacted from logs.
     */
    register(value: Secret["value"], kind: Secret["kind"]): void;

    /** Removes all registered secrets from the keychain. */
    clearAllSecrets(): void;

    /** A snapshot of all currently registered secrets. */
    readonly allSecrets: Secret[];
}
