import * as fs from "fs/promises";
import { type MongoLogWriter, MongoLogManager } from "mongodb-log-writer";
import { LoggerBase, type Keychain, type LogLevel, type LogPayload, type LoggerType } from "@mongodb-js/mcp-core";

export class DiskLogger extends LoggerBase<{ initialized: [] }> {
    private bufferedMessages: { level: LogLevel; payload: LogPayload }[] = [];
    private logWriter?: MongoLogWriter;

    public constructor(options: { logPath: string; onError: (error: Error) => void; keychain: Keychain }) {
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

    protected type: LoggerType = "disk";

    protected logCore(level: LogLevel, payload: LogPayload): void {
        if (!this.logWriter) {
            this.bufferedMessages.push({ level, payload });
            return;
        }

        const { id, context, message } = payload;
        const mongoDBLevel = this.mapToMongoDBLogLevel(level);

        this.logWriter[mongoDBLevel]("MONGODB-MCP", id, context, message, payload.attributes);
    }

    public override async flush(): Promise<void> {
        if (this.logWriter) {
            await this.logWriter.flush();
        }
    }
}
