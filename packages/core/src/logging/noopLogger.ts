import type { LogLevel, LogPayload } from "@mongodb-js/mcp-types";
import { LoggerBase } from "./loggerBase.js";

/** A logger that discards everything it is given. */
export class NoopLogger extends LoggerBase {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public log(_level: LogLevel, _payload: LogPayload): void {}
}
