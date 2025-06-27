import { OperationType, TelemetryToolMetadata, ToolArgs, ToolBase, ToolCategory } from "../tool.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { EJSON } from "bson";
import {
    PlaygroundRunError,
    PlaygroundRunRequest,
    PlaygroundRunResponse,
} from "../../common/playground/playgroundClient.js";

const DEFAULT_SEARCH_INDEX_DEFINITION = {
    mappings: {
        dynamic: true,
    },
};

const DEFAULT_SYNONYMS: Array<Record<string, unknown>> = [];

export const RunPipelineOperationArgs = {
    documents: z
        .array(z.record(z.string(), z.unknown()))
        .max(500)
        .describe("Documents to run the pipeline against. 500 is maximum."),
    aggregationPipeline: z
        .array(z.record(z.string(), z.unknown()))
        .describe("MongoDB aggregation pipeline to run on the provided documents."),
    searchIndexDefinition: z
        .record(z.string(), z.unknown())
        .describe("MongoDB search index definition to create before running the pipeline.")
        .optional()
        .default(DEFAULT_SEARCH_INDEX_DEFINITION),
    synonyms: z
        .array(z.record(z.any()))
        .describe("MongoDB synonyms mapping to create before running the pipeline.")
        .optional()
        .default(DEFAULT_SYNONYMS),
};

export class RunPipeline extends ToolBase {
    protected name = "run-pipeline";
    protected description =
        "Run MongoDB aggregation pipeline for provided documents without needing an Atlas account, cluster, or collection. The tool can be useful for running ad-hoc pipelines for testing or debugging.";
    protected category: ToolCategory = "playground";
    protected operationType: OperationType = "metadata";
    protected argsShape = RunPipelineOperationArgs;

    protected async execute(toolArgs: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const runRequest = this.convertToRunRequest(toolArgs);
        const runResponse = await this.runPipeline(runRequest);
        const toolResult = this.convertToToolResult(runResponse);
        return toolResult;
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }

    private async runPipeline(runRequest: PlaygroundRunRequest): Promise<PlaygroundRunResponse> {
        // import PlaygroundClient dynamically so we can mock it properly in the tests
        const { PlaygroundClient } = await import("../../common/playground/playgroundClient.js");
        const client = new PlaygroundClient();
        try {
            return await client.run(runRequest);
        } catch (error: unknown) {
            let message: string | undefined;

            if (error instanceof PlaygroundRunError) {
                message = `Error code: ${error.code}. Error message: ${error.message}.`;
            }

            throw new Error(message || "Cannot run pipeline.");
        }
    }

    private convertToRunRequest(toolArgs: ToolArgs<typeof this.argsShape>): PlaygroundRunRequest {
        try {
            return {
                documents: JSON.stringify(toolArgs.documents),
                aggregationPipeline: JSON.stringify(toolArgs.aggregationPipeline),
                indexDefinition: JSON.stringify(toolArgs.searchIndexDefinition || DEFAULT_SEARCH_INDEX_DEFINITION),
                synonyms: JSON.stringify(toolArgs.synonyms || DEFAULT_SYNONYMS),
            };
        } catch {
            throw new Error("Invalid arguments type.");
        }
    }

    private convertToToolResult(runResponse: PlaygroundRunResponse): CallToolResult {
        const content: Array<{ text: string; type: "text" }> = [
            {
                text: `Found ${runResponse.documents.length} documents":`,
                type: "text",
            },
            ...runResponse.documents.map((doc) => {
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
