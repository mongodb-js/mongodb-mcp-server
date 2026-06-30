import type { Secret } from "mongodb-redact";
import type { LoggerType, LogLevel, LogPayload } from "./loggingTypes.js";
import { LoggerBase } from "./loggerBase.js";

export class ConsoleLogger extends LoggerBase {
    protected readonly type: LoggerType = "console";

    public constructor(getSecrets?: () => Secret[]) {
        super(getSecrets);
    }

    protected logCore(level: LogLevel, payload: LogPayload): void {
        const { id, context, message } = payload;
        console.error(
            `[${level.toUpperCase()}] ${id.__value} - ${context}: ${message}${this.serializeAttributes(payload.attributes)}`
        );
    }

    private serializeAttributes(attributes?: Record<string, string>): string {
        if (!attributes || Object.keys(attributes).length === 0) {
            return "";
        }
        return ` (${Object.entries(attributes)
            .map(([key, value]) => `${key}=${value}`)
            .join(", ")})`;
    }
}
