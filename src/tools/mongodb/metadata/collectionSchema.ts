import { CollOperationArgs, ConnectionIdArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import type { SimplifiedSchema } from "mongodb-schema";
import { getSimplifiedSchema } from "mongodb-schema";
import z from "zod";
import { ONE_MB } from "../../../helpers/constants.js";
import { collectCursorUntilMaxBytesLimit } from "../../../helpers/collectCursorUntilMaxBytes.js";
import { isObjectEmpty } from "../../../helpers/isObjectEmpty.js";
import { mongoDBJsonSchemaToSimplifiedSchema } from "../../../helpers/mongoDBJsonSchemaToSimplifiedSchema.js";
import { operationWithFallback } from "../../../helpers/operationWithFallback.js";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";

const MAXIMUM_SAMPLE_SIZE_HARD_LIMIT = 50_000;

const CollectionSchemaOutputSchema = {
    schema: z.record(z.string(), z.unknown()),
    fieldsCount: z.number(),
};

export type CollectionSchemaOutput = z.infer<z.ZodObject<typeof CollectionSchemaOutputSchema>>;

export class CollectionSchemaTool extends MongoDBToolBase {
    static toolName = "collection-schema";
    public description = "Describe the schema for a collection";
    public argsShape = {
        ...ConnectionIdArgs,
        ...CollOperationArgs,
        sampleSize: z.number().optional().default(50).describe("Number of documents to sample for schema inference"),
        responseBytesLimit: z
            .number()
            .optional()
            .default(ONE_MB)
            .describe(
                "The maximum number of bytes to return in the response. This value is capped by the server's configured maximum and cannot be exceeded."
            ),
    };
    public override outputSchema = CollectionSchemaOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { connectionId, database, collection, sampleSize, responseBytesLimit }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.resolveConnection(connectionId);

        const validatorSchema = await this.getSchemaFromValidator(provider, database, collection, signal);
        if (validatorSchema) {
            const fieldsCount = Object.keys(validatorSchema).length;
            const header = `Found ${fieldsCount} fields derived from the collection's schema validator.`;
            return {
                content: formatUntrustedData(header, JSON.stringify({ database, collection, schema: validatorSchema })),
                structuredContent: {
                    schema: validatorSchema,
                    fieldsCount,
                },
            };
        }

        const cursor = provider.aggregate(
            database,
            collection,
            [{ $sample: { size: Math.min(sampleSize, MAXIMUM_SAMPLE_SIZE_HARD_LIMIT) } }],
            {
                ...this.getOperationOptions(signal),
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
                        text: "Could not deduce the schema for the requested namespace. This may be because it doesn't exist or is empty.",
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
        const header = `Found ${fieldsCount} fields in the sampled schema. Note that this schema is inferred from a sample and may not represent the full schema of the collection.`;

        return {
            content: formatUntrustedData(header, JSON.stringify({ database, collection, schema })),
            structuredContent: {
                schema,
                fieldsCount,
            },
        };
    }

    /**
     * Returns the collection's schema derived from its `$jsonSchema` validator, or
     * `undefined` when the collection has no validator, the validator does not use a
     * top-level `$jsonSchema`, the `$jsonSchema` declares no fields, or the validator
     * metadata could not be read. Callers fall back to sampling in those cases.
     */
    private async getSchemaFromValidator(
        provider: NodeDriverServiceProvider,
        database: string,
        collection: string,
        signal: AbortSignal
    ): Promise<SimplifiedSchema | undefined> {
        const jsonSchema = await operationWithFallback(async () => {
            const collections = await provider.listCollections(database, { name: collection }, { signal });
            const collectionInfo = collections[0] as
                | {
                      options?: {
                          validator?: { $jsonSchema?: Parameters<typeof mongoDBJsonSchemaToSimplifiedSchema>[0] };
                      };
                  }
                | undefined;
            return collectionInfo?.options?.validator?.$jsonSchema;
        }, undefined);
        if (!jsonSchema) {
            return undefined;
        }

        const schema = mongoDBJsonSchemaToSimplifiedSchema(jsonSchema);
        return isObjectEmpty(schema) ? undefined : schema;
    }
}
