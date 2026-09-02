import { ConnectionIdArgs, DBOperationArgs, MongoDBToolBase, type IMongoDBConfig } from "../../mongodbTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { bsonToJson } from "../../helpers/bsonToJson.js";
import { z } from "zod";

const DbStatsOutputSchema = {
    stats: z.record(z.string(), z.unknown()),
};

export type DbStatsOutput = z.infer<z.ZodObject<typeof DbStatsOutputSchema>>;

export class DbStatsTool extends MongoDBToolBase {
    static toolName = "db-stats";
    public description = "Returns statistics that reflect the use state of a single database";
    public argsShape = { ...ConnectionIdArgs, ...DBOperationArgs };
    public override outputSchema = DbStatsOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { connectionId, database }: ToolArgs<typeof this.argsShape>,
        { request }: ToolExecutionContext<IMongoDBConfig>
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.resolveConnection(connectionId);
        const result = await provider.runCommandWithCheck(
            database,
            {
                dbStats: 1,
                scale: 1,
                ...(request.server.config.maxTimeMS !== undefined && { maxTimeMS: request.server.config.maxTimeMS }),
            },
            { signal: request.signal }
        );

        const stats = bsonToJson(result);

        return {
            content: formatUntrustedData("Statistics for database:", JSON.stringify({ database, stats })),
            structuredContent: {
                stats,
            },
        };
    }
}
