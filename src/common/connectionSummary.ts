import type { ConnectionEntry } from "./connectionRegistry.js";
import { z } from "zod";

export const ConnectionSummarySchema = z.object({
    connectionId: z.string(),
    name: z.string(),
    source: z.enum(["explicit", "preconfigured"]),
    state: z.enum(["connected", "connecting", "disconnected", "errored"]).optional(),
    description: z.string(),
    lastError: z.string().optional(),
    createdAt: z.string(),
    lastUsedAt: z.string(),
});

export function summarizeConnection(entry: ConnectionEntry): z.infer<typeof ConnectionSummarySchema> {
    return {
        connectionId: entry.connectionId,
        name: entry.name,
        source: entry.source,
        state: entry.state.tag,
        description: describeConnection(entry),
        lastError: entry.lastError,
        createdAt: entry.createdAt.toISOString(),
        lastUsedAt: entry.lastUsedAt.toISOString(),
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
