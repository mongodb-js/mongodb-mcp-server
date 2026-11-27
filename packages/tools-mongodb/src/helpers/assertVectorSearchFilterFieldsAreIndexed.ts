// Based on -

import type z from "zod";
import { ErrorCodes, MongoDBError } from "../common/errors.js";
import type { VectorSearchStage } from "../mongodbSchemas.js";
import { LogId } from "@mongodb-js/mcp-core";
import type { ICompositeLogger } from "@mongodb-js/mcp-types";
import { isRecord } from "./isRecord.js";

// https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/#mongodb-vector-search-pre-filter
const ARRAY_LOGICAL_OPERATORS = ["$and", "$or", "$nor"];
const OBJECT_LOGICAL_OPERATORS = ["$not"];

export type SearchIndex = VectorSearchIndex | AtlasSearchIndex;

type VectorSearchIndex = {
    name: string;
    latestDefinition: {
        fields: Array<
            | {
                  type: "vector";
              }
            | {
                  type: "filter";
                  path: string;
              }
        >;
    };
    type: "vectorSearch";
};

type AtlasSearchIndex = {
    name: string;
    latestDefinition: unknown;
    type: "search";
};

export function assertVectorSearchFilterFieldsAreIndexed({
    searchIndexes,
    pipeline,
    logger,
}: {
    searchIndexes: SearchIndex[];
    pipeline: Record<string, unknown>[];
    logger: ICompositeLogger;
}): void {
    const searchIndexesWithFilterFields = searchIndexes
        // Ensure we only process vector search indexes and not lexical search ones
        .filter((index) => index.type === "vectorSearch")
        .reduce<Record<string, string[]>>((indexFieldMap, searchIndex) => {
            const filterFields = searchIndex.latestDefinition.fields
                .map<string | undefined>((field) => {
                    return field.type === "filter" ? field.path : undefined;
                })
                .filter((filterField) => filterField !== undefined);

            indexFieldMap[searchIndex.name] = filterFields;
            return indexFieldMap;
        }, {});
    for (const stage of pipeline) {
        if ("$vectorSearch" in stage) {
            const { $vectorSearch: vectorSearchStage } = stage as z.infer<typeof VectorSearchStage>;
            const allowedFilterFields = searchIndexesWithFilterFields[vectorSearchStage.index];
            if (!allowedFilterFields) {
                logger.warning({
                    id: LogId.toolValidationError,
                    context: "aggregate tool",
                    message: `Could not assert if filter fields are indexed - No filter fields found for index ${vectorSearchStage.index}`,
                });
                return;
            }

            const filterFieldsInStage = collectFieldsFromVectorSearchFilter(vectorSearchStage.filter);
            const filterFieldsNotIndexed = filterFieldsInStage.filter((field) => !allowedFilterFields.includes(field));
            if (filterFieldsNotIndexed.length) {
                throw new MongoDBError(
                    ErrorCodes.AtlasVectorSearchInvalidQuery,
                    `Vector search stage contains filter on fields that are not indexed by index ${vectorSearchStage.index} - ${filterFieldsNotIndexed.join(", ")}`
                );
            }
        }
    }
}

/**
 * Collects the field paths referenced by a vector search pre-filter. Throws for any
 * operator or operand shape that is not explicitly understood, so a malformed filter
 * can never hide a field from the index check (fail-closed).
 */
export function collectFieldsFromVectorSearchFilter(filter: unknown): string[] {
    if (!isRecord(filter) || !Object.keys(filter).length) {
        return [];
    }

    return Array.from(new Set(collectFields(filter)));
}

function collectFields(filter: Record<string, unknown>): string[] {
    return Object.entries(filter).flatMap<string>(([field, operand]) => {
        if (ARRAY_LOGICAL_OPERATORS.includes(field)) {
            if (!Array.isArray(operand)) {
                throw invalidVectorSearchFilter(`${field} must be an array of filter documents`);
            }
            return operand.flatMap((clause) => {
                if (!isRecord(clause)) {
                    throw invalidVectorSearchFilter(`${field} must contain filter documents`);
                }
                return collectFields(clause);
            });
        }

        if (OBJECT_LOGICAL_OPERATORS.includes(field)) {
            if (!isRecord(operand)) {
                throw invalidVectorSearchFilter(`${field} must be a filter document`);
            }
            return collectFields(operand);
        }

        if (field.startsWith("$")) {
            throw invalidVectorSearchFilter(`unsupported operator ${field}`);
        }

        return [field];
    });
}

function invalidVectorSearchFilter(message: string): MongoDBError {
    return new MongoDBError(ErrorCodes.AtlasVectorSearchInvalidQuery, `Invalid vector search filter: ${message}`);
}
