import { isAtlas } from "mongodb-build-info";

export type ConnectionStringHostType = "local" | "atlas" | "atlas_local" | "unknown";

/**
 * Get the host type from the connection string.
 * @param connectionString - The connection string to get the host type from.
 * @returns The host type.
 */
export function getHostType(connectionString: string): ConnectionStringHostType {
    if (isAtlas(connectionString)) {
        return "atlas";
    }
    return "unknown";
}
