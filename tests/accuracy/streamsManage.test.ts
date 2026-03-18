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
    peeringId: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
    requesterAccountId: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
    requesterVpcId: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
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
            prompt: `Update the pipeline for processor '${processorName}' in workspace '${workspaceName}' to add a $match stage that filters documents where status equals 'active'`,
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
                    optional: true,
                },
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
        {
            prompt: `Accept the VPC peering request 'pcx-abc123' from AWS account 123456789012 with VPC vpc-def456 in workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        workspaceName,
                        action: "accept-peering",
                        peeringId: "pcx-abc123",
                        requesterAccountId: "123456789012",
                        requesterVpcId: "vpc-def456",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Reject the VPC peering request 'pcx-xyz789' in workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        workspaceName,
                        action: "reject-peering",
                        peeringId: "pcx-xyz789",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Start processor '${processorName}' in workspace '${workspaceName}' at SP30 tier`,
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
                        tier: "SP30",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Move workspace '${workspaceName}' to the EU West region`,
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
                        newRegion: Matcher.string(),
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Add a dead letter queue to processor '${processorName}' in workspace '${workspaceName}' — use connection 'dlq-cluster', database 'errors', collection 'failed_docs'`,
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
                        dlq: {
                            connectionName: "dlq-cluster",
                            db: "errors",
                            coll: "failed_docs",
                        },
                    },
                },
            ],
            mockedTools,
        },
        // Combined stop → modify → start workflow (most common real-world manage pattern)
        {
            prompt: [
                `Stop processor 'etl' in workspace '${workspaceName}'`,
                `Update its pipeline to add a $match stage filtering status='active'`,
                "Start it back up",
            ],
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
                        resourceName: "etl",
                    },
                },
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "modify-processor",
                        workspaceName,
                        resourceName: "etl",
                        pipeline: Matcher.anyValue,
                    },
                },
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "start-processor",
                        workspaceName,
                        resourceName: "etl",
                    },
                },
            ],
            mockedTools,
        },
        // Ambiguous: "reconfigure" an existing processor should use manage (modify-processor), NOT build (processor)
        {
            prompt: `Reconfigure processor 'etl' in workspace '${workspaceName}' to read from Kafka topic 'orders' instead of 'events'`,
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
                        resourceName: "etl",
                    },
                    optional: true,
                },
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "modify-processor",
                        workspaceName,
                        resourceName: "etl",
                        pipeline: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        // Ambiguous: "I need to hook up a new Kafka source" should use build (connection), NOT discover (list-connections)
        {
            prompt: `I need to hook up a new Kafka source to workspace '${workspaceName}' with bootstrap server broker.example.com:9092`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "connection",
                        workspaceName,
                        connectionName: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        connectionType: "Kafka",
                        connectionConfig: {
                            bootstrapServers: "broker.example.com:9092",
                            authentication: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                            security: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                        },
                    },
                },
            ],
            mockedTools: {
                ...mockedTools,
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
            },
        },
        {
            prompt: `Update the bootstrap servers for connection 'events' in workspace '${workspaceName}' to broker2.example.com:9092,broker3.example.com:9092`,
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
                        connectionConfig: {
                            bootstrapServers: "broker2.example.com:9092,broker3.example.com:9092",
                        },
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Restart processor 'etl' in workspace '${workspaceName}'`,
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
                        resourceName: "etl",
                    },
                    optional: true,
                },
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "start-processor",
                        workspaceName,
                        resourceName: "etl",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Change processor 'rollup' pipeline in workspace '${workspaceName}' to use a 30-minute tumbling window instead of 1-hour, then restart it fresh without preserving state`,
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
                        resourceName: "rollup",
                    },
                    optional: true,
                },
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "modify-processor",
                        workspaceName,
                        resourceName: "rollup",
                        pipeline: Matcher.anyValue,
                    },
                },
                {
                    toolName: "atlas-streams-manage",
                    parameters: {
                        ...optionalManageParams,
                        projectId,
                        action: "start-processor",
                        workspaceName,
                        resourceName: "rollup",
                        resumeFromCheckpoint: false,
                    },
                },
            ],
            mockedTools,
        },
        // Ambiguous: "debug the processor" — informal phrasing that should map to manage's diagnostic actions or discover's diagnose
        {
            prompt: `Debug the 'etl' processor in workspace '${workspaceName}' — it seems to be processing slowly`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-discover",
                    parameters: {
                        projectId,
                        action: "diagnose-processor",
                        workspaceName,
                        resourceName: "etl",
                        responseFormat: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                        limit: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                        pageNum: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                    },
                },
            ],
            mockedTools,
        },
    ],
    { userConfig: { previewFeatures: "streams" } }
);
