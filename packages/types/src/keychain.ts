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
    /**
     * Returns the message of an `error` (or the string form of a non-error) with
     * this redactor's secrets removed, for safe logging or display.
     */
    redactErrorMessage(error: unknown): string;
}

/**
 * A keychain, for consumers that hold one and need to redact secrets (loggers,
 * tools, the server). It is immutable: its secrets are fixed at construction and
 * cannot be registered or cleared afterwards, so it never grows over a process
 * lifetime. The only action is {@link IRedactor.redact}.
 */
export type IKeychain = IRedactor;
