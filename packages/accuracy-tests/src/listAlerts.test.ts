import { expect } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";
import type { VercelAgentPromptResult } from "./sdk/agent.js";

// These tests guard the wording introduced in MCP-543: atlas-list-alerts returns the
// triggered alert events Atlas has raised (defaulting to status OPEN), not the alert
// configurations that define them. The suite checks that models pick the right status
// for triggered alerts and, crucially, do not reach for atlas-list-alerts when asked
// for alert configurations, since the server has no tool for those.

const projectId = "68f600519f16226591d054c0";

const triggeredAlerts = [
    {
        id: "alert-1",
        status: "OPEN",
        created: "2025-01-01T00:00:00.000Z",
        updated: "2025-01-02T00:00:00.000Z",
        eventTypeName: "HOST_DOWN",
        acknowledgementComment: "N/A",
    },
    {
        id: "alert-2",
        status: "OPEN",
        created: "2025-01-03T00:00:00.000Z",
        updated: "2025-01-04T00:00:00.000Z",
        eventTypeName: "REPLICATION_OPLOG_WINDOW_RUNNING_OUT",
        acknowledgementComment: "investigating",
    },
];

const resolvedAlerts = [
    {
        id: "alert-3",
        status: "CLOSED",
        created: "2024-12-01T00:00:00.000Z",
        updated: "2024-12-02T00:00:00.000Z",
        eventTypeName: "HOST_DOWN",
        acknowledgementComment: "resolved after restart",
    },
];

const mockedTools = {
    "atlas-list-alerts": (params: Record<string, unknown>): CallToolResult => {
        const status = typeof params.status === "string" ? params.status : "OPEN";
        const results = status === "CLOSED" ? resolvedAlerts : triggeredAlerts;
        return {
            content: formatUntrustedData(
                `Found ${results.length} alerts with status "${status}" in project ${projectId} (total: ${results.length})`,
                JSON.stringify(results)
            ),
        };
    },
};

// limit and pageNum are defaulted server-side, so the model normally omits them. Allow
// either an omitted value or an explicit number so the parameter score is not penalised.
const paginationParams = {
    limit: Matcher.anyOf(Matcher.undefined, Matcher.number()),
    pageNum: Matcher.anyOf(Matcher.undefined, Matcher.number()),
};

describeAccuracyTests([
    {
        // Triggered alerts, default status. The model should call the tool and rely on the
        // OPEN default rather than passing an explicit status.
        prompt: `What alerts are currently firing on my Atlas project ${projectId}?`,
        mockedTools,
        expectedToolCalls: [
            {
                toolName: "atlas-list-alerts",
                parameters: {
                    projectId,
                    status: Matcher.anyOf(Matcher.undefined, Matcher.caseInsensitiveString("OPEN")),
                    ...paginationParams,
                },
            },
        ],
        validateAgentResult: (result: VercelAgentPromptResult): void => {
            const t = result.text.toLowerCase();
            expect(t.includes("alert") || t.includes("host_down") || t.includes("oplog")).toBe(true);
        },
    },
    {
        // Resolved alerts. "Resolved/closed" must map to status CLOSED, not the OPEN default.
        prompt: `Have any alerts on my Atlas project ${projectId} already been resolved? Show me the closed ones.`,
        mockedTools,
        expectedToolCalls: [
            {
                toolName: "atlas-list-alerts",
                parameters: {
                    projectId,
                    status: Matcher.caseInsensitiveString("CLOSED"),
                    ...paginationParams,
                },
            },
        ],
        validateAgentResult: (result: VercelAgentPromptResult): void => {
            const t = result.text.toLowerCase();
            expect(t.includes("resolved") || t.includes("closed") || t.includes("alert")).toBe(true);
        },
    },
    {
        // Alert configurations are not the same as triggered alerts, and the server has no
        // tool for them. The model should not misuse atlas-list-alerts to answer this.
        prompt: `List the alert configuration settings defined for my Atlas project ${projectId} -- the rules that decide when an alert is raised, not the alerts that have already fired.`,
        systemPrompt: `The user refers to an Atlas project by its id (${projectId}). Use that id directly; do not look it up.`,
        mockedTools,
        expectedToolCalls: [],
        customScorer: (baselineScore: number, actualToolCalls): number => {
            const calledListAlerts = actualToolCalls.some((call) => call.toolName === "atlas-list-alerts");
            return calledListAlerts ? 0 : baselineScore;
        },
    },
]);
