import { EventEmitter } from "events";
import type { DefaultEventMap, EventMap, ILogger, LogLevel, LogPayload } from "@mongodb-js/mcp-types";

/**
 * The logging surface every logger shares: the per-level helpers, event emitting and flushing.
 *
 * This base deliberately knows nothing about redaction, so it carries no keychain. Extend it
 * directly only for loggers that cannot leak a secret because they emit nowhere themselves -
 * `NoopLogger`, which discards its input, and `CompositeLogger`, which forwards to children that
 * each redact with their own keychain. Anything that actually writes a message out (console, disk,
 * the MCP client...) must extend `RedactingLoggerBase` instead, which requires a keychain.
 */
export abstract class LoggerBase<T extends EventMap<T> = DefaultEventMap> extends EventEmitter<T> implements ILogger {
    public abstract log(level: LogLevel, payload: LogPayload): void;

    public info(payload: LogPayload): void {
        this.log("info", payload);
    }

    public error(payload: LogPayload): void {
        this.log("error", payload);
    }

    public debug(payload: LogPayload): void {
        this.log("debug", payload);
    }

    public notice(payload: LogPayload): void {
        this.log("notice", payload);
    }

    public warning(payload: LogPayload): void {
        this.log("warning", payload);
    }

    public critical(payload: LogPayload): void {
        this.log("critical", payload);
    }

    public alert(payload: LogPayload): void {
        this.log("alert", payload);
    }

    public emergency(payload: LogPayload): void {
        this.log("emergency", payload);
    }

    public flush(): Promise<PromiseSettledResult<void>[]> {
        return Promise.resolve([]);
    }
}
