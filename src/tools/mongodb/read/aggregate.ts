import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, formatUntrustedData, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { checkIndexUsage } from "../../../helpers/indexCheck.js";

export const AggregateArgs = {
    pipeline: z.array(z.object({}).passthrough()).describe("An array of aggregation stages to execute"),
};

export class AggregateTool extends MongoDBToolBase {
    public name = "aggregate";
    protected description = "Run an aggregation against a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        ...AggregateArgs,
    };
    public operationType: OperationType = "read";

    protected async execute({
        database,
        collection,
        pipeline,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();

        // Check if aggregate operation uses an index if enabled
        if (this.config.indexCheck) {
            await checkIndexUsage(provider, database, collection, "aggregate", async () => {
                return provider
                    .aggregate(database, collection, pipeline, {}, { writeConcern: undefined })
                    .explain("queryPlanner");
            });
        }

        const documents = await provider.aggregate(database, collection, pipeline).toArray();

        return {
            content: formatUntrustedData(`The aggregation resulted in ${documents.length} documents`, documents),
        };
    }
}
