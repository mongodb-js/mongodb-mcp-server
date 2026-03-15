import { formatUntrustedData } from "../../src/tools/tool.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Matcher } from "./sdk/matcher.js";

const projectId = "68f600519f16226591d054c0";
const workspaceName = "myworkspace";

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
    "atlas-streams-build": (): CallToolResult => {
        return {
            content: [
                {
                    type: "text",
                    text: "Resource created successfully.",
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
            prompt: "Create a new streams workspace called 'analytics' in AWS Virginia",
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "workspace",
                        workspaceName: "analytics",
                        cloudProvider: "AWS",
                        region: Matcher.string(),
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Add a Kafka connection named 'events' to workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "connection",
                        workspaceName,
                        connectionName: "events",
                        connectionType: "Kafka",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Add a Sample data connection to workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "connection",
                        workspaceName,
                        connectionType: "Sample",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Connect my Atlas cluster 'mycluster' to workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "connection",
                        workspaceName,
                        connectionType: "Cluster",
                        connectionConfig: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Deploy a processor named 'etl' that reads from 'events' and writes to 'output' in workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "processor",
                        workspaceName,
                        processorName: "etl",
                        pipeline: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Set up a stream processing pipeline from Kafka to my Atlas cluster in workspace '${workspaceName}'`,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: Matcher.anyValue,
                        workspaceName,
                    },
                },
            ],
            mockedTools,
        },
    ],
    { userConfig: { previewFeatures: "streams" } }
);
