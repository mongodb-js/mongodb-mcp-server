import type { IKeychain, LoggerType, LogLevel, LogPayload } from "@mongodb-js/mcp-types";
import { LoggerBase } from "./loggerBase.js";

const noopKeychain: IKeychain = {
    register(): void {},
    clearAllSecrets(): void {},
    allSecrets: [],
};

export class CompositeLogger extends LoggerBase {
    protected readonly type?: LoggerType;

    private readonly loggers: LoggerBase[] = [];
    private readonly attributes: Record<string, string> = {};

    constructor({ keychain = noopKeychain, loggers }: { keychain?: IKeychain; loggers: LoggerBase[] }) {
        super({ keychain });
        this.loggers = loggers;
    }

    public addLogger(logger: LoggerBase): void {
        this.loggers.push(logger);
    }

    public log(level: LogLevel, payload: LogPayload): void {
        for (const logger of this.loggers) {
            const attributes =
                Object.keys(this.attributes).length > 0 || payload.attributes
                    ? { ...this.attributes, ...payload.attributes }
                    : undefined;
            logger.log(level, { ...payload, attributes });
        }
    }

    protected logCore(): void {
        throw new Error("logCore should never be invoked on CompositeLogger");
    }

    public setAttribute(key: string, value: string): void {
        this.attributes[key] = value;
    }

    public override async flush(): Promise<PromiseSettledResult<void>[]> {
        const results = await Promise.allSettled(this.loggers.map((logger) => logger.flush()));
        return results.flatMap((r) => (r.status === "fulfilled" ? r.value : [r]));
    }
}
