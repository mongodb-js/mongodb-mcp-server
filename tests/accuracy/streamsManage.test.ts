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
    "atlas-streams-manage": (): CallToolResult => {
        return {
            content: [
                {
                    type: "text",
                    text: "Action completed successfully.",
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

// Guard against extra optional params the LLM commonly includes
const optionalManageParams = {
    pipeline: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
    dlq: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
    newName: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
    tier: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
    resumeFromCheckpoint: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
    connectionConfig: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
    newRegion: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
    newTier: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
};

describeAccuracyTests(
    [
        {
            prompt: `Start processor '${processorName}' in workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "start-processor",
                        workspaceName,
                        resourceName: processorName,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Stop processor '${processorName}' in workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "stop-processor",
                        workspaceName,
                        resourceName: processorName,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Update the pipeline for processor '${processorName}' in workspace '${workspaceName}' to add a $match stage`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "modify-processor",
                        workspaceName,
                        resourceName: processorName,
                        pipeline: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Scale up workspace '${workspaceName}' to SP30`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "update-workspace",
                        workspaceName,
                        newTier: "SP30",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Restart processor '${processorName}' in workspace '${workspaceName}' from the beginning`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "start-processor",
                        workspaceName,
                        resourceName: processorName,
                        resumeFromCheckpoint: false,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Change processor '${processorName}' pipeline in workspace '${workspaceName}' to filter documents where status is active`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "modify-processor",
                        workspaceName,
                        resourceName: processorName,
                        pipeline: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Update the configuration of connection 'events' in workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "update-connection",
                        workspaceName,
                        resourceName: "events",
                        connectionConfig: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Rename processor '${processorName}' to 'etl-v2' in workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "modify-processor",
                        workspaceName,
                        resourceName: processorName,
                        newName: "etl-v2",
                    },
                },
            ],
            mockedTools,
        },
    ],
    { userConfig: { previewFeatures: "streams" } }
);
