import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type OperationType, type ToolArgs, formatUntrustedData } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { AtlasArgs } from "../../args.js";

const AlertStatus = z.enum(["OPEN", "TRACKING", "CLOSED"]);

export const ListAlertsArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID to list alerts for"),
    status: AlertStatus.default("OPEN").describe(
        "Status of the alerts to return. Defaults to OPEN. TRACKING means the alert condition exists but hasn't persisted beyond the notification delay. OPEN means the alert condition currently exists. CLOSED means the alert has been resolved."
    ),
    limit: z.number().int().min(1).max(500).default(100).describe("Max results per page."),
    pageNum: z.number().int().min(1).default(1).describe("Page number."),
};

export class ListAlertsTool extends AtlasToolBase {
    static toolName = "atlas-list-alerts";
    public description = "List MongoDB Atlas alerts";
    static operationType: OperationType = "read";
    public argsShape = {
        ...ListAlertsArgs,
    };

    protected async execute({
        projectId,
        status,
        limit,
        pageNum,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const data = await this.apiClient.listAlerts({
            params: {
                path: {
                    groupId: projectId,
                },
                query: {
                    status,
                    itemsPerPage: limit,
                    pageNum: pageNum,
                    includeCount: true,
                },
            },
        });

        if (!data?.results?.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No alerts with status "${status}" found in your MongoDB Atlas project.`,
                    },
                ],
            };
        }

        const alerts = data.results.map((alert) => ({
            id: alert.id,
            status: alert.status,
            created: alert.created ? new Date(alert.created).toISOString() : "N/A",
            updated: alert.updated ? new Date(alert.updated).toISOString() : "N/A",
            eventTypeName: alert.eventTypeName,
            acknowledgementComment: alert.acknowledgementComment ?? "N/A",
        }));

        return {
            content: formatUntrustedData(
                `Found ${alerts.length} alerts with status "${status}" in project ${projectId} (total: ${data.totalCount ?? alerts.length})`,
                JSON.stringify(alerts)
            ),
        };
    }
}
