import { formatUntrustedData } from "../../src/tools/tool.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Matcher } from "./sdk/matcher.js";

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
            prompt: "List all stream processing workspaces in project 'StreamsProject'",
            systemPrompt: projectContext,
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
            systemPrompt: projectContext,
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
            systemPrompt: projectContext,
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
            systemPrompt: projectContext,
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
            systemPrompt: projectContext,
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
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "get-logs",
                        workspaceName,
                        logType: Matcher.anyOf(Matcher.value("operational"), Matcher.undefined),
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Show me the networking configuration for my streams project 'StreamsProject'",
            systemPrompt: projectContext,
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
            systemPrompt: projectContext,
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
            systemPrompt: projectContext,
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
            systemPrompt: projectContext,
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
        // Project discovery test: no project context given, LLM may call atlas-list-projects
        // or ask the user for the project ID — both are valid. Turn 2 supplies the ID so
        // the LLM can call atlas-streams-discover regardless of which path it took.
        {
            prompt: ["What stream processing workspaces do I have?", `The project ID is '${projectId}'`],
            expectedToolCalls: [
                { toolName: "atlas-list-projects", parameters: {}, optional: true },
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
            prompt: [
                `Why is my processor '${processorName}' failing in workspace '${workspaceName}'?`,
                "Show me the error logs",
            ],
            systemPrompt: projectContext,
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
            prompt: `Give me the full detailed configuration of all processors in workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "list-processors",
                        workspaceName,
                        responseFormat: "detailed",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Give me the full configuration details of all connections in workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "list-connections",
                        workspaceName,
                        responseFormat: "detailed",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Show me the AWS networking details for us-east-1 in my streams project",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "get-networking",
                        cloudProvider: "AWS",
                        region: "us-east-1",
                    },
                },
            ],
            mockedTools,
        },
        // PrivateLink-specific: LLM might try list-connections or build/teardown instead of get-networking
        {
            prompt: `Show me the PrivateLink connections for workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "get-networking",
                        workspaceName,
                    },
                },
            ],
            mockedTools,
        },
        // Ambiguous: "what's the current pipeline" could suggest manage (modify), but should use discover (inspect)
        {
            prompt: `What's the current pipeline for processor '${processorName}' in workspace '${workspaceName}'?`,
            systemPrompt: projectContext,
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
        // Pagination: user asks for next page of processors
        {
            prompt: `Show me the next page of processors in workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "list-processors",
                        workspaceName,
                        pageNum: 2,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Show me the error logs for processor 'etl' in workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "get-logs",
                        workspaceName,
                        resourceName: "etl",
                        logType: Matcher.anyOf(Matcher.value("operational"), Matcher.undefined),
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `When was processor 'etl' last started and stopped in workspace '${workspaceName}'?`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "get-logs",
                        workspaceName,
                        resourceName: "etl",
                        logType: "audit",
                    },
                },
            ],
            mockedTools,
        },
    ],
    { userConfig: { previewFeatures: "streams" } }
);
