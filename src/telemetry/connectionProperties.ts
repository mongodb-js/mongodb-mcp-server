import type { ConnectionMetadata } from "./types.js";
import { ConnectionString } from "mongodb-connection-string-url";
import { isAtlas } from "mongodb-build-info";
import { Session } from "../common/session.js";


/**
 * Determine host_type and atlas_hostname
 * 
 * Check if atlas_local_deployment_id is set (for atlas-local connections)
 * This will be set by atlas-local tools in their resolveTelemetryMetadata
 * We check it here by looking at the current metadata being built
 * Since this method is called during resolveTelemetryMetadata, we need to
 * determine host_type based on available connection info
 * @param metadata - The metadata to set the host type and atlas hostname on
 */ 
export function getHostType(connectionString: string, session: Session): "atlas" | "local" | "cloud" | "atlas_local" | undefined {
    // If there is no connection information available, return
    if (!connectionString && !session.connectedAtlasCluster && !session.isConnectedToMongoDB) {
        return undefined;
    }

    if (session?.connectedAtlasCluster) {
        return "atlas";
    }

    
    if (connectionString) {
        // Check if connection string indicates Atlas using mongodb-build-info
        const isAtlasConnection = isAtlas(connectionString);
        if (isAtlasConnection) {
            return "atlas";
        }   

        // Check if it's a cloud connection (not localhost)
        const connString = new ConnectionString(connectionString);
        const hosts = connString.hosts;
        // hosts is an array of strings in "host:port" format
        const isLocalhost = hosts.some((host) => {
            const hostname = host.split(":")[0];
            return hostname === "localhost" || hostname === "127.0.0.1";
        });
        return isLocalhost ? "local" : "cloud";
    }
    
    // Default to local if we can't determine
    return "local";
}