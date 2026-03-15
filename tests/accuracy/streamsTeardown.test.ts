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
    "atlas-streams-teardown": (): CallToolResult => {
        return {
            content: [
                {
                    type: "text",
                    text: "Resource deleted successfully.",
                },
            ],
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
            prompt: `Delete processor '${processorName}' from workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-teardown",
                    parameters: {
                        projectId,
                        resource: "processor",
                        workspaceName,
                        resourceName: processorName,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Remove connection 'events' from workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-teardown",
                    parameters: {
                        projectId,
                        resource: "connection",
                        workspaceName,
                        resourceName: "events",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Delete workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-teardown",
                    parameters: {
                        projectId,
                        resource: "workspace",
                        workspaceName,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Clean up my streams environment — remove workspace '${workspaceName}' and everything in it`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-teardown",
                    parameters: {
                        projectId,
                        resource: "workspace",
                        workspaceName,
                    },
                },
            ],
            mockedTools,
        },
    ],
    { userConfig: { previewFeatures: "streams" } }
);
