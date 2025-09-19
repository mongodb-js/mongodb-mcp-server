import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { checkIndexUsage } from "../../../helpers/indexCheck.js";
import { EJSON } from "bson";
import { ErrorCodes, MongoDBError } from "../../../common/errors.js";
import { zEJSON } from "../../args.js";

export const AggregateArgs = {
    pipeline: z.array(zEJSON()).describe("An array of aggregation stages to execute"),
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

        this.assertOnlyUsesPermittedStages(pipeline);

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
            content: formatUntrustedData(
                `The aggregation resulted in ${documents.length} documents.`,
                documents.length > 0 ? EJSON.stringify(documents) : undefined
            ),
        };
    }

    private assertOnlyUsesPermittedStages(pipeline: Record<string, unknown>[]): void {
        const writeOperations: OperationType[] = ["update", "create", "delete"];
        let writeStageForbiddenError = "";

        if (this.config.readOnly) {
            writeStageForbiddenError = "In readOnly mode you can not run pipelines with $out or $merge stages.";
        } else if (this.config.disabledTools.some((t) => writeOperations.includes(t as OperationType))) {
            writeStageForbiddenError =
                "When 'create', 'update', or 'delete' operations are disabled, you can not run pipelines with $out or $merge stages.";
        }

        if (!writeStageForbiddenError) {
            return;
        }

        for (const stage of pipeline) {
            if (stage.$out || stage.$merge) {
                throw new MongoDBError(ErrorCodes.ForbiddenWriteOperation, writeStageForbiddenError);
            }
        }
    }
}
