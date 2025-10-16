import type { Client } from "@mongodb-js-preview/atlas-local";

export type AtlasLocalClientFactoryFn = () => Promise<Client | undefined>;

export const defaultCreateAtlasLocalClient: AtlasLocalClientFactoryFn = async () => {
    console.log("defaultCreateAtlasLocalClient");
    try {
        // Import Atlas Local client asyncronously
        // This will fail on unsupported platforms
        // also measure the time it takes to import the client
        const { Client: AtlasLocalClient } = await import("@mongodb-js-preview/atlas-local");

        try {
            // Connect to Atlas Local client
            // This will fail if docker is not running
            const client = AtlasLocalClient.connect();

            // Set Atlas Local client
            return client;
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
