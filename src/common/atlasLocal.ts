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
        } catch (dockerError) {
            console.warn(
                "Failed to connect to Atlas Local client (Docker not available or not running), atlas-local tools will be disabled (error: ",
                dockerError,
                ")"
            );
        }
    } catch (importError) {
        console.warn(
            "Failed to import Atlas Local client (platform not supported), atlas-local tools will be disabled (error: ",
            importError,
            ")"
        );
    }

    return undefined;
};
