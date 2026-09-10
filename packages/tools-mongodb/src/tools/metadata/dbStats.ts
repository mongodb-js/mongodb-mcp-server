import { connectionScopedArgsShape, DBOperationArgs, MongoDBToolBase, type IMongoDBConfig } from "../../mongodbTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { bsonToJson } from "../../helpers/bsonToJson.js";
import { z } from "zod";

const DbStatsOutputSchema = {
    stats: z.record(z.string(), z.unknown()),
};

export type DbStatsOutput = z.infer<z.ZodObject<typeof DbStatsOutputSchema>>;

const DbStatsArgsShapeVariants = connectionScopedArgsShape(DBOperationArgs);

export class DbStatsTool extends MongoDBToolBase {
    static toolName = "db-stats";
    public description = "Returns statistics that reflect the use state of a single database";
    public argsShape(): typeof DbStatsArgsShapeVariants.preconfigured {
        return this.selectConnectionScopedArgsShape(DbStatsArgsShapeVariants);
    }
    public override outputSchema(): typeof DbStatsOutputSchema {
        return DbStatsOutputSchema;
    }

    static operationType: OperationType = "metadata";

    protected async execute(
        { connectionId, database }: ToolArgs<ReturnType<typeof this.argsShape>>,
        { request }: ToolExecutionContext<IMongoDBConfig>
    ): Promise<ToolResult<ReturnType<typeof this.outputSchema>>> {
        const provider = await this.resolveConnection(connectionId);
        const result = await provider.runCommandWithCheck(
            database,
            {
                dbStats: 1,
                scale: 1,
                ...(this.server.config.maxTimeMS !== undefined && { maxTimeMS: this.server.config.maxTimeMS }),
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
