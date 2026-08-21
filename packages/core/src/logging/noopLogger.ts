import type { IKeychain, LoggerType } from "@mongodb-js/mcp-types";
import { LoggerBase } from "./loggerBase.js";

const noopKeychain: IKeychain = {
    register(): void {},
    clearAllSecrets(): void {},
    allSecrets: [],
};

export class NoopLogger extends LoggerBase {
    protected readonly type?: LoggerType;

    constructor() {
        super({ keychain: noopKeychain });
    }

    protected logCore(): void {}
}
