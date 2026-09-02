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
    limit: z.number().int().min(1).max(500).default(10).describe("Max results per page."),
    pageNum: z.number().int().min(1).default(1).describe("Page number."),
    includeCount: z
        .boolean()
        .default(false)
        .describe("Whether to include the total number of matching alerts. Defaults to false for faster responses."),
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
        { projectId, status, limit, pageNum, includeCount }: ToolArgs<typeof this.argsShape>,
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
                        includeCount,
                    },
                },
            },
            context
        );

        // The API omits totalCount when includeCount=false, but some environments return an
        // explicit 0 even when results are present (only report a positive count then).
        // For the empty case the count is either absent or a genuine 0, so report it as-is.
        const apiTotalCount = data?.totalCount;
        const hasAccurateCount = (apiTotalCount ?? 0) > 0;

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
        const totalText = hasAccurateCount ? ` (total: ${apiTotalCount})` : "";
        // A full page means more results may exist on later pages.
        const paginationText =
            alerts.length === limit ? ". Use pagination arguments if more results are expected." : "";

        return {
            content: formatUntrustedData(
                `Found ${alerts.length} alerts with status "${status}" in project ${projectId}${totalText}${paginationText}`,
                JSON.stringify(alerts)
            ),
            structuredContent: {
                projectId,
                status,
                alerts,
                ...(hasAccurateCount && { totalCount: apiTotalCount }),
            },
        };
    }
}
