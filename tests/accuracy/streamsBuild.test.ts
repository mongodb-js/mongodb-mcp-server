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

const optionalProjectDiscovery = [{ toolName: "atlas-list-projects", parameters: {}, optional: true }];

const optionalWorkspaceDiscovery = [
    ...optionalProjectDiscovery,
    { toolName: "atlas-streams-discover", parameters: { projectId, action: "list-workspaces" }, optional: true },
];

// Simulate prior conversation context where the project was already established
const projectContext = `The user is working in Atlas project 'StreamsProject' (projectId: '${projectId}').`;

// Guard against extra optional params the LLM commonly includes
const optionalWorkspaceParams = {
    tier: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
    includeSampleData: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
};

const optionalConnectionParams = {
    connectionConfig: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
};

const optionalProcessorParams = {
    autoStart: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
    dlq: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
};

describeAccuracyTests(
    [
        {
            prompt: "Create a new streams workspace called 'analytics' in AWS Virginia",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalWorkspaceParams,
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
            prompt: [
                `Add a Kafka connection named 'events' to workspace '${workspaceName}'`,
                "Use bootstrap server broker.example.com:9092 with PLAIN authentication, username 'user1', and SASL_SSL security",
            ],
            systemPrompt: projectContext,
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
                        connectionConfig: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Add a Sample data connection to workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalConnectionParams,
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
            systemPrompt: projectContext,
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
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalProcessorParams,
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
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalConnectionParams,
                        ...optionalProcessorParams,
                        projectId,
                        resource: Matcher.anyValue,
                        workspaceName,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Add an S3 connection named 'archive' to workspace '${workspaceName}' using my AWS IAM role`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "connection",
                        workspaceName,
                        connectionName: "archive",
                        connectionType: "S3",
                        connectionConfig: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Add an HTTPS webhook connection named 'alerts' with URL https://hooks.example.com/webhook to workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "connection",
                        workspaceName,
                        connectionName: "alerts",
                        connectionType: "Https",
                        connectionConfig: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: [
                `Add an AWS Kinesis connection named 'kinesis-ingest' to workspace '${workspaceName}'`,
                "Use IAM role arn:aws:iam::123456789012:role/my-kinesis-role",
            ],
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "connection",
                        workspaceName,
                        connectionName: "kinesis-ingest",
                        connectionType: "AWSKinesisDataStreams",
                        connectionConfig: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: [
                `Add an AWS Lambda connection named 'transform' to workspace '${workspaceName}'`,
                "Use IAM role arn:aws:iam::123456789012:role/my-lambda-role",
            ],
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "connection",
                        workspaceName,
                        connectionName: "transform",
                        connectionType: "AWSLambda",
                        connectionConfig: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Add a Confluent Schema Registry connection named 'registry' with URL https://schema-registry.example.com to workspace '${workspaceName}'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "connection",
                        workspaceName,
                        connectionName: "registry",
                        connectionType: "SchemaRegistry",
                        connectionConfig: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Deploy a processor named 'solar-rollup' in workspace '${workspaceName}' that reads from 'sample_stream_solar', aggregates into 10-second tumbling windows grouped by device_id, and writes averages to the 'analytics.solar_rollup' collection via 'mycluster'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalProcessorParams,
                        projectId,
                        resource: "processor",
                        workspaceName,
                        processorName: "solar-rollup",
                        pipeline: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Create a processor named 'filter-alerts' in workspace '${workspaceName}' that reads from Kafka topic 'input-events' via connection 'kafka-source', filters documents where severity is 'critical', and emits to Kafka topic 'critical-alerts' via connection 'kafka-sink'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalProcessorParams,
                        projectId,
                        resource: "processor",
                        workspaceName,
                        processorName: "filter-alerts",
                        pipeline: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Deploy a processor named 'webhook-notifier' in workspace '${workspaceName}' that reads from Kafka connection 'events' topic 'alerts' and sends each document to the HTTPS connection 'webhook'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalProcessorParams,
                        projectId,
                        resource: "processor",
                        workspaceName,
                        processorName: "webhook-notifier",
                        pipeline: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Deploy a processor named 'etl-safe' in workspace '${workspaceName}' that reads from 'events' topic 'raw-data' and writes to 'mycluster' collection 'processed.output', with a dead letter queue writing to connection 'dlq-cluster' database 'errors' collection 'failed'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalProcessorParams,
                        projectId,
                        resource: "processor",
                        workspaceName,
                        processorName: "etl-safe",
                        pipeline: Matcher.anyValue,
                        dlq: {
                            connectionName: "dlq-cluster",
                            db: "errors",
                            coll: "failed",
                        },
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Create a processor named 'mongo-sync' in workspace '${workspaceName}' that reads change stream data from 'source-cluster' database 'app' collection 'orders' and merges into 'dest-cluster' database 'warehouse' collection 'orders'`,
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalWorkspaceDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalProcessorParams,
                        projectId,
                        resource: "processor",
                        workspaceName,
                        processorName: "mongo-sync",
                        pipeline: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Set up an AWS PrivateLink connection for my streams project with ARN arn:aws:vpce:us-east-1:123456789012:vpc-endpoint/vpce-abc123 and DNS domain streaming.example.com",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "privatelink",
                        privateLinkProvider: "AWS",
                        privateLinkConfig: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
    ],
    { userConfig: { previewFeatures: "streams" } }
);
