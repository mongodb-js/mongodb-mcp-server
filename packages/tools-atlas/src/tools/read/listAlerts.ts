import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { z } from "zod";
import { type ToolArgs, type ToolResult, formatUntrustedData } from "@mongodb-js/mcp-core";
import { AtlasToolBase } from "../../atlasTool.js";
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

const ListAlertsOutputSchema = {
    projectId: z.string(),
    status: AlertStatus,
    alerts: z.array(
        z.object({
            id: z.string(),
            status: z.string(),
            created: z.string(),
            updated: z.string(),
            eventTypeName: z.string(),
            acknowledgementComment: z.string(),
        })
    ),
    totalCount: z.number().optional(),
};

export class ListAlertsTool extends AtlasToolBase {
    static toolName = "atlas-list-alerts";
    public description =
        "List triggered alerts for a MongoDB Atlas project. These are alerts Atlas has raised, not the alert configurations that define them. Defaults to OPEN alerts; set status to TRACKING or CLOSED to see others.";
    static operationType: OperationType = "read";
    public argsShape = {
        ...ListAlertsArgs,
    };
    public override outputSchema = ListAlertsOutputSchema;

    protected async execute(
        { projectId, status, limit, pageNum }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const data = await this.apiClient.listAlerts(
            {
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
            },
            context
        );

        if (!data?.results?.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No alerts with status "${status}" found in your MongoDB Atlas project.`,
                    },
                ],
                structuredContent: {
                    projectId,
                    status,
                    alerts: [],
                    ...(data?.totalCount !== undefined && { totalCount: data.totalCount }),
                },
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
                `Found ${alerts.length} alerts with status "${status}" in project ${projectId} ${data?.totalCount !== undefined && `(total: ${data.totalCount})`}`,
                JSON.stringify(alerts)
            ),
            structuredContent: {
                projectId,
                status,
                alerts,
                ...(data.totalCount !== undefined && { totalCount: data.totalCount }),
            },
        };
    }
}
