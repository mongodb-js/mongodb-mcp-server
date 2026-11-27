import {
    CollOperationArgs,
    connectionScopedArgsShape,
    MongoDBToolBase,
    type IMongoDBConfig,
} from "../../mongodbTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { CollectionSchemaMetadata, OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { ANY_ADDITIONAL_PROPERTIES, formatUntrustedData, LogId } from "@mongodb-js/mcp-core";
import {
    convertMongoDBJSONSchemaToSimplified,
    getSimplifiedSchema,
    type SimplifiedSchema,
} from "@mongodb-js/mongodb-schema";
import { MongoServerError, type Document } from "mongodb";
import { z } from "zod";
import { ONE_MB } from "../../helpers/constants.js";
import { collectCursorUntilMaxBytesLimit } from "../../helpers/collectCursorUntilMaxBytes.js";
import { isObjectEmpty } from "../../helpers/isObjectEmpty.js";
import {
    getJsonSchemaValidator,
    mergeSimplifiedSchemas,
    type JsonSchemaValidator,
} from "../../helpers/collectionValidator.js";

const MAXIMUM_SAMPLE_SIZE_HARD_LIMIT = 50_000;
const SAMPLE_INSTEAD_HINT = "Use schemaSource 'sample' to infer the schema from documents instead.";
const UNAUTHORIZED_ERROR_CODE = 13;

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isUnauthorizedError(error: unknown): boolean {
    return (
        error instanceof MongoServerError &&
        (error.code === UNAUTHORIZED_ERROR_CODE || error.codeName === "Unauthorized")
    );
}

function describeValidatorLookupFailure(error: unknown): string {
    const reason = isUnauthorizedError(error)
        ? "the current user lacks the listCollections privilege on the database"
        : "listCollections failed";
    return `Could not read the validator for the requested namespace because ${reason}: ${getErrorMessage(error)}. ${SAMPLE_INSTEAD_HINT}`;
}

const CollectionSchemaOutputSchema = {
    schema: z.record(z.string(), z.unknown()).meta(ANY_ADDITIONAL_PROPERTIES),
    fieldsCount: z.number(),
    source: z
        .enum(["validator", "sample", "merged"])
        .describe(
            "Where the schema came from: the collection's $jsonSchema validator, a sample of documents, or both merged."
        ),
};

export type CollectionSchemaOutput = z.infer<z.ZodObject<typeof CollectionSchemaOutputSchema>>;

const CollectionSchemaArgsShapeVariants = connectionScopedArgsShape({
    ...CollOperationArgs,
    schemaSource: z
        .enum(["auto", "validator", "sample"])
        .optional()
        .default("auto")
        .describe(
            "Where to derive the schema from. 'auto' uses the collection's $jsonSchema validator when it rejects invalid writes (validationLevel 'strict' with validationAction 'error' or 'errorAndLog', or validationLevel 'constraint'), otherwise samples documents. 'validator' only uses the validator. 'sample' always samples documents."
        ),
    sampleSize: z
        .number()
        .optional()
        .default(50)
        .describe(
            "Number of documents to sample for schema inference. Ignored when the schema comes from the validator."
        ),
    responseBytesLimit: z
        .number()
        .optional()
        .default(ONE_MB)
        .describe(
            "The maximum number of bytes to return in the response. This value is capped by the server's configured maximum and cannot be exceeded. Ignored when the schema comes from the validator."
        ),
});

export class CollectionSchemaTool extends MongoDBToolBase {
    static toolName = "collection-schema";
    public description = "Describe the schema for a collection";
    public argsShape(): typeof CollectionSchemaArgsShapeVariants.preconfigured {
        return this.selectConnectionScopedArgsShape(CollectionSchemaArgsShapeVariants);
    }
    public override outputSchema(): typeof CollectionSchemaOutputSchema {
        return CollectionSchemaOutputSchema;
    }

    static operationType: OperationType = "metadata";

    protected async execute(
        {
            connectionId,
            database,
            collection,
            schemaSource,
            sampleSize,
            responseBytesLimit,
        }: ToolArgs<ReturnType<typeof this.argsShape>>,
        { request }: ToolExecutionContext<IMongoDBConfig>
    ): Promise<ToolResult<ReturnType<typeof this.outputSchema>>> {
        const provider = await this.resolveConnection(connectionId);
        // Users without the listCollections privilege can still sample documents, so a failed lookup is only fatal in
        // validator mode.
        let collectionInfos: Document[] = [];
        let lookupError: unknown;
        if (schemaSource !== "sample") {
            try {
                collectionInfos = await provider.listCollections(
                    database,
                    { name: collection },
                    this.getOperationOptions(request)
                );
            } catch (error) {
                lookupError = error;
                this.server.logger.debug({
                    id: LogId.mongodbListCollectionsFailure,
                    context: "collection-schema tool",
                    message: `Failed to read the collection validator: ${getErrorMessage(error)}`,
                });
            }
        }
        const [collectionInfo] = collectionInfos;
        const validator = getJsonSchemaValidator(collectionInfo?.options as Document | undefined);

        if (schemaSource === "validator" && !validator) {
            let text: string;
            if (lookupError !== undefined) {
                text = describeValidatorLookupFailure(lookupError);
            } else if (!collectionInfo) {
                text = "The requested namespace does not exist.";
            } else {
                text = `The requested namespace does not have a $jsonSchema validator. ${SAMPLE_INSTEAD_HINT}`;
            }

            return {
                content: [{ text, type: "text" }],
                isError: true,
                structuredContent: { schema: {}, fieldsCount: 0, source: "validator" },
            };
        }

        const validatorSchema: SimplifiedSchema =
            validator && (schemaSource === "validator" || validator.isEnforced)
                ? convertMongoDBJSONSchemaToSimplified(validator.jsonSchema)
                : {};
        const hasValidatorSchema = !isObjectEmpty(validatorSchema);

        let schema: SimplifiedSchema;
        let source: CollectionSchemaOutput["source"];
        if (schemaSource === "validator" || (hasValidatorSchema && validator?.isExhaustive)) {
            schema = validatorSchema;
            source = "validator";
        } else {
            const cursor = provider.aggregate(
                database,
                collection,
                [{ $sample: { size: Math.min(sampleSize, MAXIMUM_SAMPLE_SIZE_HARD_LIMIT) } }],
                {
                    ...this.getOperationOptions(request),
                }
            );
            const { documents } = await collectCursorUntilMaxBytesLimit({
                cursor,
                configuredMaxBytesPerQuery: this.server.config.maxBytesPerQuery,
                toolResponseBytesLimit: responseBytesLimit,
                abortSignal: request.signal,
            });
            const sampledSchema = await getSimplifiedSchema(documents);

            // The validator leaves some fields open, so fill them in from the sample.
            schema =
                hasValidatorSchema && validator
                    ? mergeSimplifiedSchemas({
                          sampled: sampledSchema,
                          declared: validatorSchema,
                          schema: validator.jsonSchema,
                      })
                    : sampledSchema;
            source = hasValidatorSchema ? "merged" : "sample";
        }

        if (isObjectEmpty(schema)) {
            return {
                content: [
                    {
                        text:
                            source === "validator"
                                ? `The $jsonSchema validator for the requested namespace does not declare any fields. ${SAMPLE_INSTEAD_HINT}`
                                : "Could not deduce the schema for the requested namespace. This may be because it doesn't exist or is empty.",
                        type: "text",
                    },
                ],
                structuredContent: {
                    schema: {},
                    fieldsCount: 0,
                    source,
                },
            };
        }

        const fieldsCount = Object.keys(schema).length;
        const header = CollectionSchemaTool.getResponseHeader({ fieldsCount, source, validator });

        return {
            content: formatUntrustedData(this.server.config, header, JSON.stringify({ database, collection, schema })),
            structuredContent: {
                schema,
                fieldsCount,
                source,
            },
        };
    }

    private static getResponseHeader({
        fieldsCount,
        source,
        validator,
    }: {
        fieldsCount: number;
        source: CollectionSchemaOutput["source"];
        validator: JsonSchemaValidator | undefined;
    }): string {
        switch (source) {
            case "sample":
                return `Found ${fieldsCount} fields in the sampled schema. Note that this schema is inferred from a sample and may not represent the full schema of the collection.`;
            case "merged":
                return `Found ${fieldsCount} fields in the schema. Fields declared by the collection's $jsonSchema validator use the validator's types; the remaining fields are inferred from a sample and may not represent the full schema of the collection.`;
            case "validator": {
                const summary = `Found ${fieldsCount} fields in the schema defined by the collection's $jsonSchema validator.`;
                if (validator?.validationLevel === "constraint") {
                    // The server guarantees every document in the collection conforms at this level.
                    return summary;
                }

                const caveat = validator?.isEnforced
                    ? "documents inserted before the validator was added, or with document validation bypassed, may not conform to it."
                    : `the validator does not reject invalid writes (validationLevel: ${validator?.validationLevel}, validationAction: ${validator?.validationAction}), so documents may not conform to it.`;
                return `${summary} Note that ${caveat}`;
            }
        }
    }

    protected override async resolveTelemetryMetadata(
        args: ToolArgs<ReturnType<typeof this.argsShape>>,
        { result }: { result: ToolResult<typeof CollectionSchemaOutputSchema> }
    ): Promise<CollectionSchemaMetadata> {
        return {
            ...(await super.resolveTelemetryMetadata(args, { result })),
            schema_source: result.structuredContent?.source,
        };
    }
}
