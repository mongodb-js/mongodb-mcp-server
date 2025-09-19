import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type OperationType, type ToolArgs, formatUntrustedData } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { AtlasArgs } from "../../args.js";

export const ListAlertsArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID to list alerts for"),
};

export class ListAlertsTool extends AtlasToolBase {
    public name = "atlas-list-alerts";
    protected description = "List MongoDB Atlas alerts";
    public operationType: OperationType = "read";
    protected argsShape = {
        ...ListAlertsArgs,
    };

    protected async execute({ projectId }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const data = await this.session.apiClient.listAlerts({
            params: {
                path: {
                    groupId: projectId,
                },
            },
        });

        if (!data?.results?.length) {
            return { content: [{ type: "text", text: "No alerts found in your MongoDB Atlas project." }] };
        }

        // Format alerts as a table
        const output =
            `Alert ID | Status | Created | Updated | Type | Comment
----------|---------|----------|----------|------|--------
` +
            data.results
                .map((alert) => {
                    const created = alert.created ? new Date(alert.created).toLocaleString() : "N/A";
                    const updated = alert.updated ? new Date(alert.updated).toLocaleString() : "N/A";
                    const comment = alert.acknowledgementComment ?? "N/A";
                    return `${alert.id} | ${alert.status} | ${created} | ${updated} | ${alert.eventTypeName} | ${comment}`;
                })
                .join("\n");

        return {
            content: formatUntrustedData(`Found ${data.results.length} alerts in project ${projectId}`, output),
        };
    }
}
