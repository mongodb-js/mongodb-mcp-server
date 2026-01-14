import type { Client } from "@mongodb-js/atlas-local";
import { LogId, type LoggerBase } from "./logger.js";

export type AtlasLocalClientFactoryFn = ({ logger }: { logger: LoggerBase }) => Promise<Client | undefined>;

let isAtlasLocalSupported: boolean = true;

export const defaultCreateAtlasLocalClient: AtlasLocalClientFactoryFn = async ({ logger }) => {
    // If we've tried and failed to load the Atlas Local client before, don't try again
    if (!isAtlasLocalSupported) {
        return undefined;
    }

    try {
        // Import Atlas Local client asyncronously
        // This will fail on unsupported platforms
        const { Client: AtlasLocalClient } = await import("@mongodb-js/atlas-local");

        try {
            // Connect to Atlas Local client
            // This will fail if docker is not running
            return AtlasLocalClient.connect();
        } catch {
            logger.warning({
                id: LogId.atlasLocalDockerNotRunning,
                message:
                    "Cannot connect to Docker. Atlas Local tools are disabled. All other tools continue to work normally.",
                context: "Atlas Local Initialization",
            });
        }
    } catch {
        isAtlasLocalSupported = false;
        logger.warning({
            id: LogId.atlasLocalUnsupportedPlatform,
            message:
                "Atlas Local is not supported on this platform. Atlas Local tools are disabled. All other tools continue to work normally.",
            context: "Atlas Local Initialization",
        });
    }

    return undefined;
};
