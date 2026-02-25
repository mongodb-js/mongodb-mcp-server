import { describe, expect, it, vi } from "vitest";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    expectDefined,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseElements,
    getDataFromUntrustedContent,
} from "../../integration/helpers.js";
import { describeWithAssistant, makeMockAssistantAPI } from "./assistantHelpers.js";
import { parse as yamlParse } from "yaml";

// Mock the devtools-proxy-support module
vi.mock("@mongodb-js/devtools-proxy-support", () => ({
    createFetch: vi.fn(),
}));

describeWithAssistant("search-knowledge", (integration) => {
    const { mockSearchResults, mockAPIError, mockNetworkError } = makeMockAssistantAPI();

    validateToolMetadata(
        integration,
        "search-knowledge",
        "Search for information in the MongoDB Assistant knowledge base. This includes official documentation, curated expert guidance, and other resources provided by MongoDB. Supports filtering by data source and version.",
        "read",
        [
            {
                name: "dataSources",
                description:
                    "A list of one or more data sources to limit the search to. You can specify a specific version of a data source by providing the version label. If not provided, the latest version of all data sources will be searched. Available data sources and their versions can be listed by calling the list-knowledge-sources tool.",
                type: "array",
                required: false,
            },
            {
                name: "limit",
                description: "The maximum number of results to return",
                type: "number",
                required: false,
            },
            {
                name: "query",
                description:
                    "A natural language query to search for in the MongoDB Assistant knowledge base. This should be a single question or a topic that is relevant to the user's MongoDB use case.",
                type: "string",
                required: true,
            },
        ]
    );

    validateThrowsForInvalidArguments(integration, "search-knowledge", [
        {}, // missing required query
        { query: 123 }, // invalid query type
        { query: "test", limit: -1 }, // invalid limit
        { query: "test", limit: 101 }, // limit too high
        { query: "test", dataSources: "invalid" }, // invalid dataSources type
        { query: "test", dataSources: [{ name: 123 }] }, // invalid dataSource name type
        { query: "test", dataSources: [{}] }, // missing required name field
    ]);

    describe("success cases", () => {
        it("searches with query only", async () => {
            const mockResults = [
                {
                    url: "https://docs.mongodb.com/manual/aggregation/",
                    title: "Aggregation Pipeline",
                    text: "The aggregation pipeline is a framework for data aggregation modeled on the concept of data processing pipelines.",
                    metadata: {
                        tags: ["aggregation", "pipeline"],
                        source: "mongodb-manual",
                    },
                },
                {
                    url: "https://docs.mongodb.com/manual/reference/operator/aggregation/",
                    title: "Aggregation Pipeline Operators",
                    text: "Aggregation pipeline operations have an array of operators available.",
                    metadata: {
                        tags: ["aggregation", "operators"],
                        source: "mongodb-manual",
                    },
                },
            ];

            mockSearchResults(mockResults);

            const response = (await integration.mcpClient().callTool({
                name: "search-knowledge",
                arguments: { query: "aggregation pipeline" },
            })) as CallToolResult;

            expect(response.isError).toBeFalsy();
            expect(response.content).toBeInstanceOf(Array);
            expect(response.content).toHaveLength(2);

            const elements = getResponseElements(response.content);

            expect(elements[0]?.text).toBe("Found 2 results in the MongoDB Assistant knowledge base.");
            expect(elements[1]?.text).toContain("<untrusted-user-data-");
            const yamlData = getDataFromUntrustedContent(elements[1]?.text ?? "");
            const results = yamlParse(yamlData) as Array<Record<string, unknown>>;

            expect(results[0]).toMatchObject({
                url: "https://docs.mongodb.com/manual/aggregation/",
                title: "Aggregation Pipeline",
                text: "The aggregation pipeline is a framework for data aggregation modeled on the concept of data processing pipelines.",
                metadata: {
                    tags: ["aggregation", "pipeline"],
                    source: "mongodb-manual",
                },
            });

            expect(results[1]).toMatchObject({
                url: "https://docs.mongodb.com/manual/reference/operator/aggregation/",
                title: "Aggregation Pipeline Operators",
                text: "Aggregation pipeline operations have an array of operators available.",
                metadata: {
                    tags: ["aggregation", "operators"],
                    source: "mongodb-manual",
                },
            });
        });

        it("searches with query, limit, and dataSources", async () => {
            const mockResults = [
                {
                    url: "https://mongodb.github.io/node-mongodb-native/",
                    title: "Node.js Driver",
                    text: "The official MongoDB driver for Node.js provides a high-level API on top of mongodb-core.",
                    metadata: {
                        tags: ["driver", "nodejs"],
                        source: "node-driver",
                    },
                },
            ];

            mockSearchResults(mockResults);

            const response = (await integration.mcpClient().callTool({
                name: "search-knowledge",
                arguments: {
                    query: "node.js driver",
                    limit: 1,
                    dataSources: [{ name: "node-driver", versionLabel: "6.0" }],
                },
            })) as CallToolResult;

            expect(response.isError).toBeFalsy();
            expect(response.content).toBeInstanceOf(Array);
            expect(response.content).toHaveLength(2);

            const elements = getResponseElements(response.content);
            expect(elements[0]?.text).toBe("Found 1 results in the MongoDB Assistant knowledge base.");

            const yamlData = getDataFromUntrustedContent(elements[1]?.text ?? "");
            const results = yamlParse(yamlData) as Array<Record<string, unknown>>;

            expect(results[0]).toMatchObject({
                url: "https://mongodb.github.io/node-mongodb-native/",
                title: "Node.js Driver",
                text: "The official MongoDB driver for Node.js provides a high-level API on top of mongodb-core.",
                metadata: {
                    tags: ["driver", "nodejs"],
                    source: "node-driver",
                },
            });
        });

        it("handles empty search results", async () => {
            mockSearchResults([]);

            const response = (await integration
                .mcpClient()
                .callTool({ name: "search-knowledge", arguments: { query: "nonexistent topic" } })) as CallToolResult;

            expect(response.isError).toBeFalsy();
            expect(response.content).toBeInstanceOf(Array);
            expect(response.content).toHaveLength(2);

            const elements = getResponseElements(response.content);
            expect(elements[0]?.text).toBe("Found 0 results in the MongoDB Assistant knowledge base.");
        });

        it("uses default limit when not specified", async () => {
            const mockResults = Array(5)
                .fill(null)
                .map((_, i) => ({
                    url: `https://docs.mongodb.com/result${i}`,
                    title: `Result ${i}`,
                    text: `Search result number ${i}`,
                    metadata: { tags: [`tag${i}`] },
                }));

            mockSearchResults(mockResults);

            const response = (await integration
                .mcpClient()
                .callTool({ name: "search-knowledge", arguments: { query: "test query" } })) as CallToolResult;

            expect(response.isError).toBeFalsy();
            expect(response.content).toHaveLength(2);

            const elements = getResponseElements(response.content);
            expect(elements[0]?.text).toBe("Found 5 results in the MongoDB Assistant knowledge base.");

            const yamlData = getDataFromUntrustedContent(elements[1]?.text ?? "");
            const results = yamlParse(yamlData) as unknown[];
            expect(results).toHaveLength(5);
        });
    });

    describe("error handling", () => {
        it("handles API error responses", async () => {
            mockAPIError(404, "Not Found");

            const response = (await integration
                .mcpClient()
                .callTool({ name: "search-knowledge", arguments: { query: "test query" } })) as CallToolResult;

            expect(response.isError).toBe(true);
            expectDefined(response.content);
            expect(response.content[0]).toHaveProperty("text");
            expect((response.content[0] as { text: string }).text).toContain(
                "Failed to search knowledge base: Not Found"
            );
        });

        it("handles network errors", async () => {
            mockNetworkError(new Error("Connection timeout"));

            const response = (await integration
                .mcpClient()
                .callTool({ name: "search-knowledge", arguments: { query: "test query" } })) as CallToolResult;

            expect(response.isError).toBe(true);
            expectDefined(response.content);
            expect(response.content[0]).toHaveProperty("text");
            expect((response.content[0] as { text: string }).text).toContain("Connection timeout");
        });
    });
});
