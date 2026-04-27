import type { LoggerType } from "./loggingTypes.js";
import { LoggerBase } from "./loggerBase.js";

export class NoopLogger extends LoggerBase {
    protected type?: LoggerType;

    constructor() {
        super(undefined);
    }

    protected logCore(): void {
        // No-op logger, does not log anything
    }
}
