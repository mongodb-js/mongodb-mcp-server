import { z } from "zod";
import { MongoDBToolBase } from "../mongodbTool.js";
import type { OperationType, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";

export const ListConnectionsOutputSchema = {
    connections: z.array(
        z.object({
            name: z.string(),
            isDefault: z.boolean(),
            status: z.enum(["idle", "connecting", "connected", "errored"]),
        })
    ),
    totalCount: z.number(),
};

export type ListConnectionsOutput = z.infer<z.ZodObject<typeof ListConnectionsOutputSchema>>;

export class ListConnectionsTool extends MongoDBToolBase {
    static toolName = "list-connections";
    public description =
        "List the pre-configured named MongoDB connections available for the optional 'connection' argument on data tools, including which one is the session default and each connection's current status.";
    public argsShape = {};
    public override outputSchema = ListConnectionsOutputSchema;
    static operationType: OperationType = "metadata";

    protected execute(): Promise<ToolResult<typeof this.outputSchema>> {
        const registry = this.session.connectionRegistry;
        const defaultName = registry.defaultName;
        const connections = registry.names().map((name) => ({
            name,
            isDefault: name === defaultName,
            status: registry.statusOf(name) ?? ("idle" as const),
        }));

        return Promise.resolve({
            content: formatUntrustedData(
                `Found ${connections.length} configured connection(s).`,
                JSON.stringify(connections)
            ),
            structuredContent: {
                connections,
                totalCount: connections.length,
            },
        });
    }
}
