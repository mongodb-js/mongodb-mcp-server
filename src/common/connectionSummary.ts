import type { ConnectionTag } from "./connectionManager.js";
import type { ConnectionEntry } from "./connectionRegistry.js";

/**
 * Presentation-oriented snapshot of a {@link ConnectionEntry}, tailored to the
 * needs of the list-connections tool and the debug resource. Deliberately not
 * part of the registry contract or the public API.
 */
export type ConnectionSummary = Pick<
    ConnectionEntry,
    "connectionId" | "name" | "source" | "lastError" | "createdAt" | "lastUsedAt"
> & {
    state: ConnectionTag;
    description: string;
};

export function summarizeConnection(entry: ConnectionEntry): ConnectionSummary {
    return {
        connectionId: entry.connectionId,
        name: entry.name,
        source: entry.source,
        state: entry.state.tag,
        description: describeConnection(entry),
        lastError: entry.lastError,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt,
    };
}

function describeConnection(entry: ConnectionEntry): string {
    const state = entry.state;
    if (state.connectedAtlasCluster) {
        return `Atlas cluster "${state.connectedAtlasCluster.clusterName}" (project ${state.connectedAtlasCluster.projectId})`;
    }

    if (entry.source === "preconfigured" && state.tag === "disconnected") {
        return "Configured connection string (not yet dialed)";
    }

    if (state.connectionStringInfo) {
        return `MongoDB connection (host type: ${state.connectionStringInfo.hostType}, auth: ${state.connectionStringInfo.authType})`;
    }

    return "MongoDB connection";
}
