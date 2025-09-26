import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OperationType } from "../tool.js";
import { AssistantToolBase } from "./assistantTool.js";
import { LogId } from "../../common/logger.js";

export const dataSourceMetadataSchema = z.object({
    id: z.string().describe("The name of the data source"),
    type: z.string().optional().describe("The type of the data source"),
    versions: z
        .array(
            z.object({
                label: z.string().describe("The version label of the data source"),
                isCurrent: z.boolean().describe("Whether this version is current active version"),
            })
        )
        .describe("A list of available versions for this data source"),
});

export const listDataSourcesResponseSchema = z.object({
    dataSources: z.array(dataSourceMetadataSchema).describe("A list of data sources"),
});

export class ListKnowledgeSourcesTool extends AssistantToolBase {
    public name = "list-knowledge-sources";
    protected description = "List available data sources in the MongoDB Assistant knowledge base";
    protected argsShape = {};
    public operationType: OperationType = "read";

    protected async execute(): Promise<CallToolResult> {
        const searchEndpoint = new URL("content/sources", this.baseUrl);
        const response = await fetch(searchEndpoint, {
            method: "GET",
            headers: this.requiredHeaders,
        });
        if (!response.ok) {
            const message = `Failed to list knowledge sources: ${response.statusText}`;
            this.session.logger.debug({
                id: LogId.assistantListKnowledgeSourcesError,
                context: "assistant-list-knowledge-sources",
                message,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: message,
                    },
                ],
                isError: true,
            };
        }
        const { dataSources } = listDataSourcesResponseSchema.parse(await response.json());

        return {
            content: dataSources.map(({ id, type, versions }) => ({
                type: "text",
                text: id,
                _meta: {
                    type,
                    versions,
                },
            })),
        };
    }
}
