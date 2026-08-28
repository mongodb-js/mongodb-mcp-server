import type {
    DefaultEventMap,
    EventMap,
    IRedactor,
    LoggerConfig,
    LoggerType,
    LogLevel,
    LogPayload,
} from "@mongodb-js/mcp-types";
import { LoggerBase } from "./loggerBase.js";

/**
 * Base class for loggers that emit a message somewhere a secret could escape to. The keychain is
 * required rather than optional: every such logger redacts, so there is no valid way to construct
 * one without the means to do it.
 */
export abstract class RedactingLoggerBase<T extends EventMap<T> = DefaultEventMap> extends LoggerBase<T> {
    private readonly keychain: IRedactor;

    constructor(options: LoggerConfig) {
        super();
        this.keychain = options.keychain;
    }

    public log(level: LogLevel, payload: LogPayload): void {
        // Redact by default for every logger. Skipping redaction must be an explicit,
        // per-call opt-out via `noRedaction` — never a default. This matters most for the
        // MCP logger, whose messages are sent to the (untrusted) MCP client and downstream
        // agent/LLM toolchain, so secrets must never be emitted there unless explicitly allowed.
        const noRedaction = payload.noRedaction !== undefined ? payload.noRedaction : false;

        this.logCore(level, {
            ...payload,
            message: this.redactIfNecessary(payload.message, noRedaction),
            attributes: this.redactAttributes(payload.attributes, noRedaction),
        });
    }

    protected abstract readonly type?: LoggerType;

    protected abstract logCore(level: LogLevel, payload: LogPayload): void;

    private redactAttributes(
        attributes: Record<string, string> | undefined,
        noRedaction: LogPayload["noRedaction"]
    ): Record<string, string> | undefined {
        if (!attributes) {
            return undefined;
        }
        return Object.fromEntries(
            Object.entries(attributes).map(([key, value]) => [key, this.redactIfNecessary(value, noRedaction)])
        );
    }

    private redactIfNecessary(message: string, noRedaction: LogPayload["noRedaction"]): string {
        // If the consumer has supplied noRedaction: true, we don't redact the log message
        // regardless of the logger type
        if (typeof noRedaction === "boolean" && noRedaction) {
            return message;
        }

        // If the consumer has supplied noRedaction: logger-type, we skip redacting if
        // our logger type is the same as what the consumer requested
        if (typeof noRedaction === "string" && noRedaction === this.type) {
            return message;
        }

        // If the consumer has supplied noRedaction: array, we skip redacting if our logger
        // type is included in that array
        if (
            typeof noRedaction === "object" &&
            Array.isArray(noRedaction) &&
            this.type &&
            noRedaction.indexOf(this.type) !== -1
        ) {
            return message;
        }

        return this.keychain.redact(message);
    }
}
