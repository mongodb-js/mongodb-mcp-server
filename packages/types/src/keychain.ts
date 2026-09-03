import type { Secret } from "mongodb-redact";

export type { Secret } from "mongodb-redact";

/**
 * The redaction half of a keychain, for consumers that need to scrub secrets out of a value but
 * have no business registering or clearing them - loggers and tools. Kept separate so those
 * consumers are not coupled to secret management just to reach {@link IRedactor.redact}.
 */
export interface IRedactor {
    /**
     * Redacts the registered secrets from the strings in `value`, returning a copy of the same
     * shape. Arrays and own enumerable properties are visited recursively, and the prototype of
     * any object descended into is preserved. Values that keep their contents behind an API
     * rather than in own properties - `Map`, `Set` and the like - are returned untouched, as are
     * non-string primitives, so not every string transitively reachable is guaranteed to be
     * redacted. Never mutates `value`, and terminates on self-referencing input.
     */
    redact<T>(value: T): T;
}

export interface IKeychain extends IRedactor {
    register(value: Secret["value"], kind: Secret["kind"]): void;
    clearAllSecrets(): void;
}
