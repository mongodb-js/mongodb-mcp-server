import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatUntrustedData, type OperationType } from "../tool.js";
import { AssistantToolBase } from "./assistantTool.js";
import { LogId } from "../../common/logger.js";
import { stringify as yamlStringify } from "yaml";

export type KnowledgeSource = {
    /** The name of the data source */
    id: string;
    /** The type of the data source */
    type: string;
    /** A list of available versions for this data source */
    versions: {
        /** The version label of the data source */
        label: string;
        /** Whether this version is the current/default version */
        isCurrent: boolean;
    }[];
};

export type ListKnowledgeSourcesResponse = {
    dataSources: KnowledgeSource[];
};

export const ListKnowledgeSourcesToolName = "list-knowledge-sources";

export class ListKnowledgeSourcesTool extends AssistantToolBase {
    public name = ListKnowledgeSourcesToolName;
    protected description = "List available data sources in the MongoDB Assistant knowledge base";
    protected argsShape = {};
    public operationType: OperationType = "read";

    protected async execute(): Promise<CallToolResult> {
        const response = await this.callAssistantApi({
            method: "GET",
            endpoint: "content/sources",
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
        const { dataSources } = (await response.json()) as ListKnowledgeSourcesResponse;

        const text = yamlStringify(
            dataSources.map((ds) => {
                const currentVersion = ds.versions.find(({ isCurrent }) => isCurrent)?.label;
                if (currentVersion) {
                    (ds as KnowledgeSource & { currentVersion: string }).currentVersion = currentVersion;
                }
                return ds;
            })
        );

        return {
            content: formatUntrustedData(
                `Found ${dataSources.length} data sources in the MongoDB Assistant knowledge base.`,
                text
            ),
        };
    }
}
