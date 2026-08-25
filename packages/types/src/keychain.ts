import type { Secret } from "mongodb-redact";

export type { Secret } from "mongodb-redact";

export interface IKeychain {
    register(value: Secret["value"], kind: Secret["kind"]): void;
    clearAllSecrets(): void;
    /**
     * Recursively redacts the registered secrets from every string reachable from `value`,
     * leaving the structure - and the prototype of any object it descends into - intact.
     * Never mutates `value`.
     */
    redact<T>(value: T): T;
}
