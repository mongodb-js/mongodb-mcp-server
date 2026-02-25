import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { EJSON } from "bson";
import { z } from "zod";

const DbStatsOutputSchema = {
    stats: z.record(z.unknown()),
};

export type DbStatsOutput = z.infer<z.ZodObject<typeof DbStatsOutputSchema>>;

export class DbStatsTool extends MongoDBToolBase {
    static toolName = "db-stats";
    public description = "Returns statistics that reflect the use state of a single database";
    public argsShape = {
        database: DbOperationArgs.database,
    };
    public override outputSchema = DbStatsOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { database }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();
        const result = await provider.runCommandWithCheck(
            database,
            {
                dbStats: 1,
                scale: 1,
            },
            { signal }
        );

        return {
            content: formatUntrustedData(`Statistics for database ${database}`, EJSON.stringify(result)),
            structuredContent: {
                stats: result,
            },
        };
    }
}
