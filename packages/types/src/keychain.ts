import type { Secret } from "mongodb-redact";

export interface IKeychain<TKey = Secret["value"], TKind = Secret["kind"]> {
    register(value: TKey, kind: TKind): void;
    clearAllSecrets(): void;
    readonly allSecrets: { value: TKey; kind: TKind }[];
}
