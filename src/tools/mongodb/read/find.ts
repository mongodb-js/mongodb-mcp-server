import { z } from "zod";
import { EJSON } from "bson";
import { SortDirection } from "mongodb";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { ToolArgs, OperationType } from "../../tool.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { checkIndexUsage } from "../../../helpers/indexCheck.js";

export function keyValueListToDocument<V = unknown>(
    keyValueList: { key: string; value: V }[] | undefined
): Record<string, V> | undefined {
    return keyValueList ? Object.fromEntries(keyValueList.map(({ key, value }) => [key, value])) : undefined;
}

export const FindArgs = {
    filter: z
        .array(
            z.object({
                key: z.string().describe("The name of the field or a MongoDB operator"),
                value: z
                    .unknown()
                    .refine((val) => val !== undefined, { message: "Value cannot be undefined." })
                    .describe("The filter expression for the key"),
            })
        )
        .optional()
        .describe(
            "Array of key-value pairs to filter documents. Each object has 'key' (field name or MongoDB operator) and 'value' (filter criteria)."
        ),
    projection: z
        .array(
            z.object({
                key: z.string().describe("The name of the field to be projected."),
                value: z
                    .unknown()
                    .refine((val) => val !== undefined, { message: "Value cannot be undefined." })
                    .describe("The projection expression for the projected field."),
            })
        )
        .optional()
        .describe(
            "Array of key-value pairs to specify which fields to project (key) and how to project them(value). Each object has 'key' (field name) and 'value' (project expression). "
        ),
    limit: z.number().optional().default(10).describe("The maximum number of documents to return"),
    sort: z
        .array(
            z.object({
                key: z.string().describe("The name of the field to apply the sort on."),
                value: z.custom<SortDirection>().describe("The sort order applied to the field being sorted."),
            })
        )
        .optional()
        .describe(
            "Array of key-value pairs to specify sort order. Each object has 'key' (field name) and 'value' (sort order)."
        ),
};

export class FindTool extends MongoDBToolBase {
    public name = "find";
    protected description = "Run a find query against a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        ...FindArgs,
    };
    public operationType: OperationType = "read";

    protected async execute({
        database,
        collection,
        filter,
        projection,
        limit,
        sort,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();

        const mongoFilter = keyValueListToDocument(filter);
        const mongoProjection = keyValueListToDocument(projection);
        const mongoSort = keyValueListToDocument(sort);

        if (this.config.indexCheck) {
            await checkIndexUsage(provider, database, collection, "find", async () => {
                return provider
                    .find(database, collection, mongoFilter, {
                        projection: mongoProjection,
                        limit,
                        sort: mongoSort,
                    })
                    .explain("queryPlanner");
            });
        }

        const documents = await provider
            .find(database, collection, mongoFilter, {
                projection: mongoProjection,
                limit,
                sort: mongoSort,
            })
            .toArray();

        const content: Array<{ text: string; type: "text" }> = [
            {
                text: `Found ${documents.length} documents in the collection "${collection}":`,
                type: "text",
            },
            ...documents.map((doc) => {
                return {
                    text: EJSON.stringify(doc),
                    type: "text",
                } as { text: string; type: "text" };
            }),
        ];

        return {
            content,
        };
    }
}
