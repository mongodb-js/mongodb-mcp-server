import type { LoggerType } from "@mongodb-js/mcp-types";
import { LoggerBase } from "./loggerBase.js";

export class NoopLogger extends LoggerBase {
    protected type?: LoggerType;

    constructor() {
        super();
    }

    protected logCore(): void {}
}
