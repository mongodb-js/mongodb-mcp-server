import type { Secret } from "mongodb-redact";
import type { IKeychain } from "@mongodb-js/mcp-types";
export type { Secret } from "mongodb-redact";

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

    get allSecrets(): Secret[] {
        return [...this.secrets];
    }
}

export function registerGlobalSecretToRedact(value: Secret["value"], kind: Secret["kind"]): void {
    Keychain.root.register(value, kind);
}
