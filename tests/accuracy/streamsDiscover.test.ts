import { formatUntrustedData } from "../../src/tools/tool.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const projectId = "68f600519f16226591d054c0";
const workspaceName = "myworkspace";
const processorName = "myprocessor";

const mockedTools = {
    "atlas-list-projects": (): CallToolResult => {
        return {
            content: formatUntrustedData(
                "Found 1 projects",
                JSON.stringify([
                    {
                        name: "StreamsProject",
                        id: projectId,
                        orgId: "68f600589f16226591d054c1",
                        orgName: "MyOrg",
                        created: "N/A",
                    },
                ])
            ),
        };
    },
    "atlas-streams-discover": (): CallToolResult => {
        return {
            content: formatUntrustedData(
                "Found 1 workspace(s)",
                JSON.stringify([
                    {
                        name: workspaceName,
                        region: "AWS/VIRGINIA_USA",
                        tier: "SP10",
                        maxTier: "SP50",
                    },
                ])
            ),
        };
    },
};

const optionalProjectDiscovery = [
    { toolName: "atlas-list-projects", parameters: {}, optional: true },
];

const optionalWorkspaceDiscovery = [
    ...optionalProjectDiscovery,
    { toolName: "atlas-streams-discover", parameters: { projectId, action: "list-workspaces" }, optional: true },
];

describeAccuracyTests(
    [
        {
            prompt: "List all stream processing workspaces in project 'StreamsProject'",
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "list-workspaces",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Show me details about stream processing workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "inspect-workspace",
                        workspaceName,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `What connections are available in workspace '${workspaceName}'?`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "list-connections",
                        workspaceName,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Show me the processors in workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "list-processors",
                        workspaceName,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Why is my processor '${processorName}' in workspace '${workspaceName}' failing?`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "diagnose-processor",
                        workspaceName,
                        resourceName: processorName,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Check the health of processor '${processorName}' in workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "diagnose-processor",
                        workspaceName,
                        resourceName: processorName,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Show me the operational logs for workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "get-logs",
                        workspaceName,
                        logType: "operational",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Show me the networking configuration for my streams project 'StreamsProject'",
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "get-networking",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Show me the details of connection 'events' in workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "inspect-connection",
                        workspaceName,
                        resourceName: "events",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Show me the full configuration of processor '${processorName}' in workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "inspect-processor",
                        workspaceName,
                        resourceName: processorName,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Show me the audit logs for workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "get-logs",
                        workspaceName,
                        logType: "audit",
                    },
                },
            ],
            mockedTools,
        },
    ],
    { userConfig: { previewFeatures: "streams" } }
);
