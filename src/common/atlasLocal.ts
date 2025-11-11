import type { Client } from "@mongodb-js/atlas-local";

export type AtlasLocalClientFactoryFn = () => Promise<Client | undefined>;

export const defaultCreateAtlasLocalClient: AtlasLocalClientFactoryFn = async () => {
    try {
        // Import Atlas Local client asyncronously
        // This will fail on unsupported platforms
        const { Client: AtlasLocalClient } = await import("@mongodb-js/atlas-local");

        try {
            // Connect to Atlas Local client
            // This will fail if docker is not running
            return AtlasLocalClient.connect();
        } catch {
            console.warn(
                "Cannot connect to Docker. Atlas Local tools are disabled. All other tools continue to work normally."
            );
        }
    } catch {
        console.warn(
            "Atlas Local is not supported on this platform. Atlas Local tools are disabled. All other tools continue to work normally."
        );
    }

    return undefined;
};
