import { expect } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

const atlasConnectClusterWithAlerts: CallToolResult = {
    content: [
        {
            type: "text",
            text: `Connected to cluster "acc-test-free-cluster".`,
        },
        {
            type: "text",
            text:
                `Note: Atlas reports open shared-tier threshold alerts for cluster "acc-test-free-cluster" affecting: CONNECTIONS_PERCENT, FLEX_DATA_SIZE_TOTAL. ` +
                `You may be near connection or storage limits on this Free/Flex deployment. ` +
                `Consider upgrading capacity (for example moving to Flex or a paid tier such as M10 or larger) if you need more headroom.`,
        },
    ],
};

describeAccuracyTests([
    {
        prompt:
            "I'm connected to my free Atlas cluster in project acc-test-project named acc-test-free-cluster. Tell me if this cluster is close to any connection or storage limits and what I should do next.",
        systemPrompt:
            "The user may refer to an Atlas deployment by project id and cluster name. If they ask about limits or alerts on that Atlas cluster, call the atlas-connect-cluster tool with those identifiers so you can read the server's response, then summarize limits and next steps from the tool output.",
        mockedTools: {
            "atlas-connect-cluster": () => atlasConnectClusterWithAlerts,
        },
        expectedToolCalls: [
            {
                toolName: "atlas-connect-cluster",
                parameters: {
                    projectId: "acc-test-project",
                    clusterName: "acc-test-free-cluster",
                    connectionType: Matcher.anyOf(
                        Matcher.undefined,
                        Matcher.value("standard"),
                        Matcher.value("private"),
                        Matcher.value("privateEndpoint")
                    ),
                },
            },
        ],
        validateAgentResult: (result) => {
            const t = result.text.toLowerCase();
            expect(
                t.includes("alert") ||
                    t.includes("limit") ||
                    t.includes("upgrade") ||
                    t.includes("flex") ||
                    t.includes("m10") ||
                    t.includes("storage") ||
                    t.includes("connection")
            ).toBe(true);
        },
    },
]);
