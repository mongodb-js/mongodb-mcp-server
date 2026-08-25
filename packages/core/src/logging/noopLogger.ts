import { LoggerBase } from "./loggerBase.js";

/** A logger that discards everything it is given. */
export class NoopLogger extends LoggerBase {
    public log(): void {}
}
