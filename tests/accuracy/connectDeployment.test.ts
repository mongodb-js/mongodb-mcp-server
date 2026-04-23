import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatUntrustedData } from "../../src/tools/tool.js";
import { mockCreateDeploymentResponse } from "./createDeployment.test.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: "Connect to the local MongoDB cluster called 'my-database'",
        expectedToolCalls: [
            {
                toolName: "atlas-local-connect-deployment",
                parameters: {
                    deploymentName: "my-database",
                },
            },
        ],
    },
    {
        prompt: "Connect to the local MongoDB atlas database called 'my-instance'",
        expectedToolCalls: [
            {
                toolName: "atlas-local-connect-deployment",
                parameters: {
                    deploymentName: "my-instance",
                },
            },
        ],
    },
    {
        prompt: "If and only if, the local MongoDB deployment 'local-mflix' exists, then connect to it",
        mockedTools: {
            "atlas-local-list-deployments": (): CallToolResult => ({
                content: formatUntrustedData(
                    "Found 1 deployments",
                    '[{"name":"local-mflix","state":"Running","mongodbVersion":"6.0"}]'
                ),
            }),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
            {
                toolName: "atlas-local-connect-deployment",
                parameters: {
                    deploymentName: "local-mflix",
                },
            },
        ],
    },
    {
        prompt: "Create and then connect to a new local MongoDB cluster named 'local-mflix'",
        mockedTools: {
            // Mocking the create-deployment tool call here so that consecutive
            // test runs remains unaffected
            "atlas-local-create-deployment": mockCreateDeploymentResponse("local-mflix"),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "local-mflix",
                    loadSampleData: Matcher.anyOf(Matcher.undefined, Matcher.boolean()),
                },
            },
            {
                toolName: "atlas-local-connect-deployment",
                parameters: {
                    deploymentName: "local-mflix",
                },
            },
        ],
    },
]);
