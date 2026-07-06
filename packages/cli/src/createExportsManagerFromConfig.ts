import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { ExportsManager } from "@mongodb-js/mcp-tools-mongodb";
import type { UserConfig } from "./config/userConfig.js";

export type CreateExportsManagerFromConfigOptions = {
    config: UserConfig;
    logger: CompositeLogger;
};

export function createExportsManagerFromConfig({
    config,
    logger,
}: CreateExportsManagerFromConfigOptions): ExportsManager {
    return ExportsManager.init({
        options: {
            exportsPath: config.exportsPath,
            exportTimeoutMs: config.exportTimeoutMs,
            exportCleanupIntervalMs: config.exportCleanupIntervalMs,
        },
        logger,
    });
}
