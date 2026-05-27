import type { Secret } from "mongodb-redact";
export type { Secret } from "mongodb-redact";

/**
 * Per-owner secret store. A Keychain holds secret values that should
 * be redacted from log output by `mongodb-redact`. Most code paths
 * should accept a `Keychain` (or {@link CompositeKeychain}) by
 * reference at construction time, not reach for the deprecated
 * `Keychain.root` static.
 */
export class Keychain {
    private secrets: Secret[] = [];

    /**
     * @deprecated Will be removed in a future release. The process-wide
     * `Keychain.root` is retained only as a backward-compat shim for
     * code that hasn't yet been converted to receive a keychain by
     * dependency injection — it writes to the same module-local
     * fallback keychain that `registerGlobalSecretToRedact` writes to.
     * New code should accept a Keychain in its constructor / options,
     * register session-scoped secrets via `session.keychain.register`,
     * and read parser-discovered secrets from the `secrets` field of
     * `parseUserConfig`'s return value.
     */
    static get root(): Keychain {
        return defaultBootstrapKeychain;
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

/**
 * Module-local fallback keychain backing the deprecated
 * `Keychain.root` / `registerGlobalSecretToRedact` API surface.
 *
 * This is intentionally *not* exported and *not* a static on the
 * class: keeping it module-local makes it clear to readers that this
 * is a transitional shim, not the long-term contract. New code
 * should construct its own `Keychain` and pass it through.
 */
const defaultBootstrapKeychain = new Keychain();

/**
 * @deprecated Will be removed in a future release. Construct a
 * Keychain in the caller's scope and pass it to whatever needs to
 * register or read secrets. This helper writes to a module-local
 * fallback keychain that `Keychain.root` also exposes.
 */
export function registerGlobalSecretToRedact(value: Secret["value"], kind: Secret["kind"]): void {
    defaultBootstrapKeychain.register(value, kind);
}

/**
 * Read-through union of several keychains.
 *
 * Used when one logger needs to redact secrets from multiple
 * ownership scopes at once — typically a bootstrap keychain
 * (containing process-level config secrets like the Atlas API client
 * secret) composed with a per-session keychain (containing anything
 * the session registered at runtime). The composite exposes the same
 * `Keychain` contract so loggers don't need to know they're holding a
 * composite vs a single scope.
 *
 * `register` always lands in the FIRST delegate; the rest are
 * read-only from the composite's perspective. This keeps ownership
 * unambiguous: each composite has exactly one "writable" backing
 * keychain, and the others are sources of pre-registered secrets.
 */
export class CompositeKeychain extends Keychain {
    private readonly delegates: readonly Keychain[];

    constructor(delegates: readonly Keychain[]) {
        super();
        if (delegates.length === 0) {
            throw new Error("CompositeKeychain requires at least one delegate keychain.");
        }
        this.delegates = delegates;
    }

    override register(value: Secret["value"], kind: Secret["kind"]): void {
        this.delegates[0]!.register(value, kind);
    }

    override clearAllSecrets(): void {
        for (const delegate of this.delegates) {
            delegate.clearAllSecrets();
        }
    }

    override get allSecrets(): Secret[] {
        const result: Secret[] = [];
        for (const delegate of this.delegates) {
            result.push(...delegate.allSecrets);
        }
        return result;
    }
}
