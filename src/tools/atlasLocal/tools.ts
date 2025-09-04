import { ListDeploymentsTool } from "./read/listDeployments.js";
import type AtlasLocal from "@mongodb-js-preview/atlas-local";

// Don't use this directly, use BuildAtlasLocalTools instead
const atlasLocalTools = [ListDeploymentsTool];

// Build the Atlas Local tools
export const BuildAtlasLocalTools = async (): Promise<typeof atlasLocalTools> => {
    // Initialize the Atlas Local client
    const client = await GetAtlasLocalClient();

    // If the client is found, set it on the tools
    // On unsupported platforms, the client will be undefined
    if (client) {
        // Set the client on the tools
        atlasLocalTools.forEach((tool) => {
            tool.prototype.client = client;
        });
    }

    return atlasLocalTools;
};

export const GetAtlasLocalClient = async (): Promise<AtlasLocal.Client | undefined> => {
    try {
        const { Client: AtlasLocalClient } = await import("@mongodb-js-preview/atlas-local");
        return AtlasLocalClient.connect();
    } catch (error) {
        // We only get here if the user is running atlas-local on a unsupported platform
        console.warn("Atlas Local native binding not available:", error);
        return undefined;
    }
};
