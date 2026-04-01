import fs from "fs/promises";
import { type MongoLogWriter, MongoLogManager } from "mongodb-log-writer";
import type { Keychain } from "../keychain.js";
import type { LogLevel, LogPayload, LoggerType, MongoLogId } from "./index.js";
import { LoggerBase } from "./loggerBase.js";

export class DiskLogger extends LoggerBase<{ initialized: [] }> {
    private bufferedMessages: { level: LogLevel; payload: LogPayload }[] = [];
    private logWriter?: MongoLogWriter;

    public constructor(logPath: string, onError: (error: Error) => void, keychain: Keychain) {
        super(keychain);

        void this.initialize(logPath, onError);
    }

    private async initialize(logPath: string, onError: (error: Error) => void): Promise<void> {
        try {
            await fs.mkdir(logPath, { recursive: true });

            const manager = new MongoLogManager({
                directory: logPath,
                retentionDays: 30,
                // eslint-disable-next-line no-console
                onwarn: console.warn,
                // eslint-disable-next-line no-console
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
            // If the log writer is not initialized, buffer the message
            this.bufferedMessages.push({ level, payload });
            return;
        }

        const { id, context, message } = payload;
        const mongoLogId = typeof id === "string" ? id : (id as unknown as { __value: string }).__value;
        const mongoDBLevel = this.mapToMongoDBLogLevel(level);

        this.logWriter[mongoDBLevel](
            "MONGODB-MCP",
            mongoLogId as unknown as MongoLogId,
            context,
            message,
            payload.attributes
        );
    }
}
