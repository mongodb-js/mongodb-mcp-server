import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Matcher } from "./sdk/matcher.js";

export function mockCreateDeploymentResponse(name: string): () => CallToolResult {
    return () => ({
        content: [
            {
                type: "text",
                text: `Deployment with container ID "1FOO" and name "${name}" created.`,
            },
        ],
    });
}

describeAccuracyTests([
    {
        prompt: "Setup a local MongoDB cluster named 'local-cluster'",
        mockedTools: {
            // Mocking the create-deployment tool call here so that consecutive
            // test runs remains unaffected
            "atlas-local-create-deployment": mockCreateDeploymentResponse("local-cluster"),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "local-cluster",
                    loadSampleData: Matcher.anyOf(Matcher.undefined, Matcher.boolean()),
                },
            },
        ],
    },
    {
        prompt: "Create a local MongoDB instance named 'local-cluster'",
        mockedTools: {
            // Mocking the create-deployment tool call here so that consecutive
            // test runs remains unaffected
            "atlas-local-create-deployment": mockCreateDeploymentResponse("local-cluster"),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "local-cluster",
                    loadSampleData: Matcher.anyOf(Matcher.undefined, Matcher.boolean()),
                },
            },
        ],
    },
    {
        prompt: "Setup a local MongoDB database named 'local-cluster'",
        mockedTools: {
            // Mocking the create-deployment tool call here so that consecutive
            // test runs remains unaffected
            "atlas-local-create-deployment": mockCreateDeploymentResponse("local-cluster"),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "local-cluster",
                    loadSampleData: Matcher.anyOf(Matcher.undefined, Matcher.boolean()),
                },
            },
        ],
    },
    {
        prompt: "Setup a local MongoDB cluster, do not specify a name",
        mockedTools: {
            // Mocking the create-deployment tool call here so that consecutive
            // test runs remains unaffected
            "atlas-local-create-deployment": mockCreateDeploymentResponse("local1536"),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    loadSampleData: Matcher.anyOf(Matcher.undefined, Matcher.boolean()),
                },
            },
        ],
    },
    {
        prompt: "If and only if, the local MongoDB deployment 'new-database' does not exist, then create it",
        mockedTools: {
            // Mocking the create-deployment tool call here so that consecutive
            // test runs remains unaffected
            "atlas-local-create-deployment": mockCreateDeploymentResponse("new-database"),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "new-database",
                    loadSampleData: Matcher.anyOf(Matcher.undefined, Matcher.boolean()),
                },
            },
        ],
    },
    {
        // This is a negative verification, here we're confirming no calls to
        // create deployment because the cluster exists.
        prompt: "If and only if, the local MongoDB deployment 'existing-database' does not exist, then create it",
        mockedTools: {
            "atlas-local-list-deployments": (): CallToolResult => ({
                content: [
                    { type: "text", text: "Found 1 deployment:" },
                    {
                        type: "text",
                        text: "Deployment Name | State | MongoDB Version\n----------------|----------------|----------------\nexisting-database | Running | 6.0",
                    },
                ],
            }),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
        ],
    },
    {
        prompt: "Create a local MongoDB cluster named 'sample-cluster' with sample data",
        mockedTools: {
            // Mocking the create-deployment tool call here so that consecutive
            // test runs remains unaffected
            "atlas-local-create-deployment": mockCreateDeploymentResponse("sample-cluster"),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "sample-cluster",
                    loadSampleData: true,
                },
            },
        ],
    },
    {
        prompt: "Create a local MongoDB cluster named 'empty-cluster' without sample data",
        mockedTools: {
            // Mocking the create-deployment tool call here so that consecutive
            // test runs remains unaffected
            "atlas-local-create-deployment": mockCreateDeploymentResponse("empty-cluster"),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "empty-cluster",
                    loadSampleData: false,
                },
            },
        ],
    },
]);
