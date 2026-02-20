import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { getSimplifiedSchema } from "mongodb-schema";
import z from "zod";
import { ONE_MB } from "../../../helpers/constants.js";
import { collectCursorUntilMaxBytesLimit } from "../../../helpers/collectCursorUntilMaxBytes.js";
import { isObjectEmpty } from "../../../helpers/isObjectEmpty.js";

const MAXIMUM_SAMPLE_SIZE_HARD_LIMIT = 50_000;

const CollectionSchemaOutputSchema = {
    schema: z.record(z.unknown()),
    fieldsCount: z.number(),
};

export type CollectionSchemaOutput = z.infer<z.ZodObject<typeof CollectionSchemaOutputSchema>>;

export class CollectionSchemaTool extends MongoDBToolBase {
    static toolName = "collection-schema";
    public description = "Describe the schema for a collection";
    public argsShape = {
        ...DbOperationArgs,
        sampleSize: z.number().optional().default(50).describe("Number of documents to sample for schema inference"),
        responseBytesLimit: z
            .number()
            .optional()
            .default(ONE_MB)
            .describe(
                `The maximum number of bytes to return in the response. This value is capped by the server's configured maxBytesPerQuery and cannot be exceeded.`
            ),
    };
    public override outputSchema = CollectionSchemaOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { database, collection, sampleSize, responseBytesLimit }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();
        const cursor = provider.aggregate(
            database,
            collection,
            [{ $sample: { size: Math.min(sampleSize, MAXIMUM_SAMPLE_SIZE_HARD_LIMIT) } }],
            {
                signal,
            }
        );
        const { documents } = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: this.config.maxBytesPerQuery,
            toolResponseBytesLimit: responseBytesLimit,
            abortSignal: signal,
        });
        const schema = await getSimplifiedSchema(documents);

        if (isObjectEmpty(schema)) {
            return {
                content: [
                    {
                        text: `Could not deduce the schema for "${database}.${collection}". This may be because it doesn't exist or is empty.`,
                        type: "text",
                    },
                ],
                structuredContent: {
                    schema: {},
                    fieldsCount: 0,
                },
            };
        }

        const fieldsCount = Object.keys(schema).length;
        const header = `Found ${fieldsCount} fields in the schema for "${database}.${collection}". Note that this schema is inferred from a sample and may not represent the full schema of the collection.`;

        return {
            content: formatUntrustedData(`${header}`, JSON.stringify(schema)),
            structuredContent: {
                schema,
                fieldsCount,
            },
        };
    }
}
