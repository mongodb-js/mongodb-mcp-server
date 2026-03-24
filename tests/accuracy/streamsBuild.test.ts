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
                        region: "VIRGINIA_USA",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Add a Kafka connection named 'events' to workspace '${workspaceName}' with bootstrap server broker.example.com:9092, PLAIN authentication, username 'user1', and SASL_SSL security`,
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
                        connectionConfig: {
                            bootstrapServers: "broker.example.com:9092",
                            authentication: {
                                mechanism: "PLAIN",
                                username: "user1",
                                password: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                            },
                            security: {
                                protocol: "SASL_SSL",
                            },
                        },
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
                        connectionName: Matcher.anyOf(Matcher.undefined, Matcher.string()),
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
                        connectionName: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        connectionType: "Cluster",
                        connectionConfig: {
                            clusterName: "mycluster",
                            dbRoleToExecute: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                        },
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
            prompt: [
                `Add a Kafka connection named 'events' to workspace '${workspaceName}' with bootstrap server broker.example.com:9092`,
                `Now connect my Atlas cluster 'mycluster' to workspace '${workspaceName}'`,
                `Deploy a processor in workspace '${workspaceName}' that reads from Kafka connection 'events' and writes to 'mycluster' collection 'pipeline.output'`,
            ],
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
                        connectionType: "Kafka",
                        connectionName: "events",
                    },
                },
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalConnectionParams,
                        projectId,
                        resource: "connection",
                        workspaceName,
                        connectionName: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        connectionType: "Cluster",
                    },
                },
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalProcessorParams,
                        projectId,
                        resource: "processor",
                        workspaceName,
                        pipeline: Matcher.anyValue,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: [
                `Add an S3 connection named 'archive' to workspace '${workspaceName}'`,
                "Use IAM role arn:aws:iam::123456789012:role/my-s3-role",
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
                        connectionName: "archive",
                        connectionType: "S3",
                        connectionConfig: {
                            aws: {
                                roleArn: "arn:aws:iam::123456789012:role/my-s3-role",
                            },
                        },
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
                        connectionConfig: {
                            url: "https://hooks.example.com/webhook",
                            headers: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                        },
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
                        connectionConfig: {
                            aws: {
                                roleArn: "arn:aws:iam::123456789012:role/my-kinesis-role",
                            },
                        },
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
                        connectionConfig: {
                            aws: {
                                roleArn: "arn:aws:iam::123456789012:role/my-lambda-role",
                            },
                        },
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
                        ...optionalConnectionParams,
                        projectId,
                        resource: "connection",
                        workspaceName,
                        connectionName: "registry",
                        connectionType: "SchemaRegistry",
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
            prompt: [
                "Set up an AWS PrivateLink connection for my streams project with ARN arn:aws:vpce:us-east-1:123456789012:vpc-endpoint/vpce-abc123 and DNS domain streaming.example.com",
                "No specific vendor, just use the default",
            ],
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "privatelink",
                        workspaceName: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        privateLinkConfig: {
                            provider: "AWS",
                            region: Matcher.anyOf(Matcher.undefined, Matcher.value("us-east-1")),
                            arn: "arn:aws:vpce:us-east-1:123456789012:vpc-endpoint/vpce-abc123",
                            dnsDomain: "streaming.example.com",
                            dnsSubDomain: Matcher.undefined,
                            vendor: Matcher.anyOf(Matcher.undefined, Matcher.value("GENERIC")),
                        },
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Set up an AWS S3 vendor PrivateLink connection in us-east-1 for my streams project with service endpoint com.amazonaws.us-east-1.s3",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId: Matcher.anyOf(Matcher.value(projectId), Matcher.anyValue),
                        resource: Matcher.value("privatelink"),
                        workspaceName: Matcher.anyValue,
                        privateLinkConfig: {
                            provider: Matcher.value("AWS"),
                            region: Matcher.anyOf(Matcher.value("us-east-1"), Matcher.anyValue),
                            vendor: Matcher.value("S3"),
                            serviceEndpointId: Matcher.anyOf(
                                Matcher.value("com.amazonaws.us-east-1.s3"),
                                Matcher.anyValue
                            ),
                        },
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Set up an AWS MSK vendor PrivateLink for my streams project using ARN arn:aws:kafka:us-east-1:123456789012:cluster/my-msk/abc-123",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId: Matcher.anyOf(Matcher.value(projectId), Matcher.anyValue),
                        resource: Matcher.value("privatelink"),
                        workspaceName: Matcher.anyValue,
                        privateLinkConfig: {
                            provider: Matcher.value("AWS"),
                            vendor: Matcher.value("MSK"),
                            arn: Matcher.value("arn:aws:kafka:us-east-1:123456789012:cluster/my-msk/abc-123"),
                        },
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Set up an AWS Kinesis PrivateLink in us-east-1 for my streams project",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId: Matcher.anyOf(Matcher.value(projectId), Matcher.anyValue),
                        resource: Matcher.value("privatelink"),
                        workspaceName: Matcher.anyValue,
                        privateLinkConfig: {
                            provider: Matcher.value("AWS"),
                            vendor: Matcher.value("KINESIS"),
                            region: Matcher.anyOf(Matcher.value("us-east-1"), Matcher.anyValue),
                        },
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Set up an Azure EventHub PrivateLink for my streams project with DNS domain mynamespace.servicebus.windows.net and endpoint ID /subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.EventHub/namespaces/mynamespace",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId: Matcher.anyOf(Matcher.value(projectId), Matcher.anyValue),
                        resource: Matcher.value("privatelink"),
                        workspaceName: Matcher.anyValue,
                        privateLinkConfig: {
                            provider: Matcher.value("AZURE"),
                            vendor: Matcher.value("EVENTHUB"),
                            dnsDomain: Matcher.value("mynamespace.servicebus.windows.net"),
                            serviceEndpointId: Matcher.anyOf(
                                Matcher.value(
                                    "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.EventHub/namespaces/mynamespace"
                                ),
                                Matcher.anyValue
                            ),
                        },
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Set up an Azure Confluent PrivateLink for my streams project with DNS domain pkc-abc123.eastus2.azure.confluent.cloud",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId: Matcher.anyOf(Matcher.value(projectId), Matcher.anyValue),
                        resource: Matcher.value("privatelink"),
                        workspaceName: Matcher.anyValue,
                        privateLinkConfig: {
                            provider: Matcher.value("AZURE"),
                            vendor: Matcher.value("CONFLUENT"),
                            dnsDomain: Matcher.value("pkc-abc123.eastus2.azure.confluent.cloud"),
                        },
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Set up a GCP Confluent vendor PrivateLink for my streams project with service attachment URI projects/my-project/regions/us-central1/serviceAttachments/confluent-attach-1",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId: Matcher.anyOf(Matcher.value(projectId), Matcher.anyValue),
                        resource: Matcher.value("privatelink"),
                        workspaceName: Matcher.anyValue,
                        privateLinkConfig: {
                            provider: Matcher.value("GCP"),
                            vendor: Matcher.value("CONFLUENT"),
                            gcpServiceAttachmentUris: Matcher.anyValue,
                        },
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: `Create and immediately start a processor named 'live-etl' in workspace '${workspaceName}' that reads from 'events' and writes to 'mycluster' collection 'output.data'`,
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
                        processorName: "live-etl",
                        pipeline: Matcher.anyValue,
                        autoStart: true,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Create a production streams workspace called 'prod-analytics' in AWS Oregon with SP30 tier and no sample data",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        projectId,
                        resource: "workspace",
                        workspaceName: "prod-analytics",
                        cloudProvider: "AWS",
                        region: "OREGON_USA",
                        tier: "SP30",
                        includeSampleData: false,
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Create a streams workspace 'eu-analytics' on Azure in West Europe",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalWorkspaceParams,
                        projectId,
                        resource: "workspace",
                        workspaceName: "eu-analytics",
                        cloudProvider: "AZURE",
                        region: "westeurope",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Set up a GCP streams workspace 'asia-proc' in us-central1",
            systemPrompt: projectContext,
            expectedToolCalls: [
                ...optionalProjectDiscovery,
                {
                    toolName: "atlas-streams-build",
                    parameters: {
                        ...optionalWorkspaceParams,
                        projectId,
                        resource: "workspace",
                        workspaceName: "asia-proc",
                        cloudProvider: "GCP",
                        region: "US_CENTRAL1",
                    },
                },
            ],
            mockedTools,
        },
    ],
    {}
);
