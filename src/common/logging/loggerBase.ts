import { EventEmitter } from "events";
import { redact } from "mongodb-redact";
import type { Keychain } from "../keychain.js";
import type { EventMap, DefaultEventMap, LoggerType, LogLevel, LogPayload } from "./loggingTypes.js";

export abstract class LoggerBase<T extends EventMap<T> = DefaultEventMap> extends EventEmitter<T> {
    private readonly defaultUnredactedLogger: LoggerType = "mcp";

    constructor(private readonly keychain: Keychain | undefined) {
        super();
    }

    public log(level: LogLevel, payload: LogPayload): void {
        // If no explicit value is supplied for unredacted loggers, default to "mcp"
        const noRedaction = payload.noRedaction !== undefined ? payload.noRedaction : this.defaultUnredactedLogger;

        this.logCore(level, {
            ...payload,
            message: this.redactIfNecessary(payload.message, noRedaction),
        });
    }

    protected abstract readonly type?: LoggerType;

    protected abstract logCore(level: LogLevel, payload: LogPayload): void;

    private redactIfNecessary(message: string, noRedaction: LogPayload["noRedaction"]): string {
        if (typeof noRedaction === "boolean" && noRedaction) {
            // If the consumer has supplied noRedaction: true, we don't redact the log message
            // regardless of the logger type
            return message;
        }

        if (typeof noRedaction === "string" && noRedaction === this.type) {
            // If the consumer has supplied noRedaction: logger-type, we skip redacting if
            // our logger type is the same as what the consumer requested
            return message;
        }

        if (
            typeof noRedaction === "object" &&
            Array.isArray(noRedaction) &&
            this.type &&
            noRedaction.indexOf(this.type) !== -1
        ) {
            // If the consumer has supplied noRedaction: array, we skip redacting if our logger
            // type is included in that array
            return message;
        }

        return redact(message, this.keychain?.allSecrets ?? []);
    }

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

    protected mapToMongoDBLogLevel(level: LogLevel): "info" | "warn" | "error" | "debug" | "fatal" {
        switch (level) {
            case "info":
                return "info";
            case "warning":
                return "warn";
            case "error":
                return "error";
            case "notice":
            case "debug":
                return "debug";
            case "critical":
            case "alert":
            case "emergency":
                return "fatal";
            default:
                return "info";
        }
    }
}
