import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { EJSON } from "bson";
import { createEmbeddingProvider, EmbeddingProviderFactory } from "../../../embedding/embeddingProviderFactory.js";
import { LogId } from "../../../common/logger.js";

/*
 * VectorSearchTool
 * Executes a vector search using the $vectorSearch aggregation stage.
 * Requires a MongoDB server/Atlas cluster with vector search support and a
 * vector index built on the specified path. We implement this as a read
 * operation by running a single-stage aggregation pipeline under the hood.
 */

export const VectorSearchArgs = {
    queryText: z
        .string()
        .max(1024, "queryText must be at most 1024 characters")
        .describe(
            "Raw search text/context that will be embedded using the configured embedding model; represents the vector search intent."
        ),
    numCandidates: z
        .number()
        .int()
        .positive()
        .default(100)
        .describe("Number of approximate candidates to consider (higher = potentially better recall, more cost)"),
    limit: z
        .number()
        .int()
        .positive()
        .default(10)
        .describe("Maximum number of results to return"),
    filter: z
        .object({})
        .passthrough()
        .optional()
        .describe("Optional filter (standard query predicate) to apply before ranking results"),
    includeVector: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, include the vector field in the projection (may be large)"),
};

export class VectorSearchV2Tool extends MongoDBToolBase {
    public name = "vector-search";
    protected description = "Execute a vector similarity search on a MongoDB collection using $vectorSearch";
    protected argsShape = {
        ...DbOperationArgs,
        ...VectorSearchArgs,
    };
    public operationType: OperationType = "read";

    protected async execute({
        database,
        collection,
        queryText,
        numCandidates,
        limit,
        filter,
        includeVector,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();

        // Resolve path from config
        const resolvedPath = this.config.vectorSearchPath;
        if (!resolvedPath) {
            throw new Error(
                "Vector search requires 'path' argument to be provided while setting up MCP."
            );
        }

        // Resolve index from config
        const resolvedIndex = this.config.vectorSearchIndex;
        if (!resolvedIndex) {
            throw new Error(
                "Vector search requires 'index' argument to be provided while setting up MCP."
            );
        }

        if (!queryText) {
            throw new Error("'queryText' must be provided to perform vector search");
        }

        // Always embed the provided queryText
    const embeddingProvider = createEmbeddingProvider(this.config);
        const embeddings = await embeddingProvider.embed([queryText]);
        const queryVector = embeddings[0];
        if (!queryVector || queryVector.length === 0) {
            throw new Error("Embedding provider returned empty embedding.");
        }

        // Construct the $vectorSearch stage
        const vectorStage: Record<string, unknown> = {
            $vectorSearch: {
                queryVector,
                path: resolvedPath,
                limit,
                numCandidates,
            },
        };
        if (filter) {
            (vectorStage.$vectorSearch as any).filter = filter; // eslint-disable-line @typescript-eslint/no-explicit-any
        }
        if (resolvedIndex) {
            (vectorStage.$vectorSearch as any).index = resolvedIndex; // eslint-disable-line @typescript-eslint/no-explicit-any
        }

        // Build the full pipeline. Optionally project out the vector field unless requested.
        const pipeline: Record<string, unknown>[] = [vectorStage];
        if (!includeVector) {
            // Exclude the vector path by default to keep output concise (unless the path is dotted, project root minus that field)
            const projection: Record<string, number> = {};
            const topLevelPath = resolvedPath.split(".")[0] ?? resolvedPath; // ensure string
            projection[topLevelPath as string] = 0; // We exclude; if user needs it they set includeVector=true
            pipeline.push({ $project: projection });
        }

        const cursor = provider.aggregate(database, collection, pipeline);
        const results = await cursor.toArray();

        return {
            content: formatUntrustedData(
                `Vector search returned ${results.length} document(s) from collection "${collection}" using path "${resolvedPath}."`,
                results.length > 0 ? EJSON.stringify(results) : undefined
            ),
        };
    }

    protected verifyAllowed(): boolean {
        // Centralized embedding configuration validation
        if (!EmbeddingProviderFactory.isEmbeddingConfigValid(this.config)) {
            this.session.logger.warning({
                                id: LogId.toolUpdateFailure,
                                context: "tool",
                                message: `Tool ${this.name} could not be configured due to incomplete embedding configuration.`,
                                noRedaction: true,
                            });
            return false;
        }

        // For V2 semantics: BOTH vectorSearchIndex and vectorSearchPath must be set
        if (!this.config.vectorSearchIndex || !this.config.vectorSearchPath) return false;
        
        return super.verifyAllowed();
    }
}
