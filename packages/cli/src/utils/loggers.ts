import { ConsoleLogger, DiskLogger } from "@mongodb-js/mcp-logging";
import { CompositeLogger, type Keychain } from "@mongodb-js/mcp-core";
import { MongoLogManager } from "mongodb-log-writer";
import * as fs from "fs/promises";
import type { UserConfig } from "../config/userConfig.js";

export async function createDefaultLoggers({
    config,
    keychain,
}: {
    config: UserConfig;
    keychain: Keychain;
}): Promise<CompositeLogger> {
    const baseLoggers: (ConsoleLogger | DiskLogger)[] = [];

    if (config.loggers.includes("stderr")) {
        baseLoggers.push(new ConsoleLogger({ keychain }));
    }

    if (config.loggers.includes("disk")) {
        await fs.mkdir(config.logPath, { recursive: true });

        const manager = new MongoLogManager({
            directory: config.logPath,
            retentionDays: 30,
            onwarn: console.warn,
            onerror: console.error,
            gzip: false,
            retentionGB: 1,
        });

        await manager.cleanupOldLogFiles();
        const logWriter = await manager.createLogWriter();

        baseLoggers.push(
            new DiskLogger({
                logWriter,
                keychain,
            })
        );
    }

    return new CompositeLogger({ loggers: baseLoggers });
}
