import * as fs from "fs/promises";
import { type MongoLogWriter, MongoLogManager } from "mongodb-log-writer";
import { LoggerBase } from "@mongodb-js/mcp-core";
import type { LogLevel, LogPayload, LoggerType } from "@mongodb-js/mcp-types";
import type { IKeychain } from "@mongodb-js/mcp-types";
import type { MongoLogPayload } from "./types.js";

export class DiskLogger extends LoggerBase<{ initialized: [] }> {
    private bufferedMessages: { level: LogLevel; payload: LogPayload }[] = [];
    private logWriter?: MongoLogWriter;

    public constructor(options: { logPath: string; onError: (error: Error) => void; keychain: IKeychain }) {
        super({ keychain: options.keychain });

        void this.initialize(options.logPath, options.onError);
    }

    private async initialize(logPath: string, onError: (error: Error) => void): Promise<void> {
        try {
            await fs.mkdir(logPath, { recursive: true });

            const manager = new MongoLogManager({
                directory: logPath,
                retentionDays: 30,
                onwarn: console.warn,
                onerror: console.error,
                gzip: false,
                retentionGB: 1,
            });

            await manager.cleanupOldLogFiles();

            this.logWriter = await manager.createLogWriter();

            for (const message of this.bufferedMessages) {
                this.logCore(message.level, message.payload);
            }
            this.bufferedMessages = [];
            this.emit("initialized");
        } catch (error: unknown) {
            onError(error as Error);
        }
    }

    protected readonly type: LoggerType = "disk";

    protected logCore(level: LogLevel, payload: LogPayload): void {
        if (!this.logWriter) {
            this.bufferedMessages.push({ level, payload });
            return;
        }

        const mongoPayload = payload as MongoLogPayload;
        const { id, context, message } = mongoPayload;
        const mongoDBLevel = this.mapToMongoDBLogLevel(level);

        this.logWriter[mongoDBLevel]("MONGODB-MCP", id, context, message, payload.attributes);
    }

    public override async flush(): Promise<PromiseSettledResult<void>[]> {
        if (this.logWriter) {
            return Promise.allSettled([this.logWriter.flush()]);
        }
        return [];
    }
}
