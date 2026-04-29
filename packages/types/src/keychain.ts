export interface IKeychain {
    register(value: unknown, kind: string): void;
    clearAllSecrets(): void;
    readonly allSecrets: { value: unknown; kind: string }[];
}
