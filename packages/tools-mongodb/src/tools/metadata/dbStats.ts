import { DBOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { EJSON } from "bson";
import z from "zod";

const DbStatsOutputSchema = {
    stats: z.record(z.string(), z.unknown()),
};

export type DbStatsOutput = z.infer<z.ZodObject<typeof DbStatsOutputSchema>>;

export class DbStatsTool extends MongoDBToolBase {
    static toolName = "db-stats";
    public description = "Get statistics for a MongoDB database";
    public argsShape = {
        ...DBOperationArgs,
    };
    public override outputSchema = DbStatsOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { database }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        const stats = await provider.runCommandWithCheck(
            database,
            {
                dbStats: 1,
            },
            {
                ...this.getOperationOptions(signal),
            }
        );

        return {
            content: formatUntrustedData(`Statistics for database "${database}":`, EJSON.stringify(stats)),
            structuredContent: {
                stats,
            },
        };
    }
}
