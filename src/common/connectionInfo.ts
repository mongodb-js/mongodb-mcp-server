import { isAtlas } from 'mongodb-build-info';

/**
 * Get the host type from the connection string.
 * @param connectionString - The connection string to get the host type from.
 * @returns The host type.
 */
export function getHostType(connectionString: string): "atlas" | "unknown" {
    if (isAtlas(connectionString)) {
        return "atlas";
    }
    return "unknown";
}