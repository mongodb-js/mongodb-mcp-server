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

const optionalProjectDiscovery = [{ toolName: "atlas-list-projects", parameters: {}, optional: true }];

const optionalWorkspaceDiscovery = [
    ...optionalProjectDiscovery,
    { toolName: "atlas-streams-discover", parameters: { projectId, action: "list-workspaces" }, optional: true },
];

// Simulate prior conversation context where the project was already established
const projectContext = `The user is working in Atlas project 'StreamsProject' (projectId: '${projectId}').`;

describeAccuracyTests(
    [
        {
            prompt: `Delete processor '${processorName}' from workspace '${workspaceName}'`,
            systemPrompt: projectContext,
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
            systemPrompt: projectContext,
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
            systemPrompt: projectContext,
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
            prompt: "Delete the PrivateLink connection 'pl-abc123'",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-teardown",
                    parameters: {
                        projectId,
                        resource: "privatelink",
                        resourceName: "pl-abc123",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Remove VPC peering connection 'pcx-def456'",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-teardown",
                    parameters: {
                        projectId,
                        resource: "peering",
                        resourceName: "pcx-def456",
                    },
                },
            ],
            mockedTools,
        },
        // Ambiguous: "disconnect" a connection could suggest manage (update-connection), but should use teardown (delete)
        {
            prompt: `Disconnect the 'events' source from workspace '${workspaceName}' — we don't need it anymore`,
            systemPrompt: projectContext,
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
        // Multi-turn: list processors first, then delete one
        {
            prompt: [
                `What processors are running in workspace '${workspaceName}'?`,
                `Delete processor '${processorName}'`,
            ],
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "list-processors",
                        workspaceName,
                    },
                },
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
            mockedTools: {
                ...mockedTools,
                "atlas-streams-discover": (): CallToolResult => {
                    return {
                        content: formatUntrustedData(
                            "Found 1 processor(s)",
                            JSON.stringify([
                                {
                                    name: processorName,
                                    state: "STARTED",
                                    tier: "SP10",
                                },
                            ])
                        ),
                    };
                },
            },
        },
    ],
    { userConfig: { previewFeatures: "streams" } }
);
