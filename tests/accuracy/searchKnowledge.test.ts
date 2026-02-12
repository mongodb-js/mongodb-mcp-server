import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

// Mock response for the search-knowledge tool
const mockSearchKnowledgeResult: CallToolResult = {
    content: [
        {
            type: "text",
            text: "Found 2 results in the MongoDB Assistant knowledge base.",
        },
        {
            type: "text",
            text: `<untrusted-user-data-mock>
- url: https://www.mongodb.com/docs/manual/aggregation/
  title: Aggregation Pipeline
  text: The aggregation pipeline is a framework for data aggregation modeled on the concept of data processing pipelines.
  metadata:
    tags:
      - aggregation
      - pipeline
- url: https://www.mongodb.com/docs/manual/core/indexes/
  title: Indexes
  text: Indexes support the efficient execution of queries in MongoDB.
  metadata:
    tags:
      - indexes
      - performance
</untrusted-user-data-mock>`,
        },
    ],
};

describeAccuracyTests([
    {
        prompt: "Search the MongoDB documentation for aggregation pipeline stages",
        expectedToolCalls: [
            {
                toolName: "search-knowledge",
                parameters: {
                    query: Matcher.string(),
                    limit: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                    dataSources: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                },
            },
        ],
        mockedTools: {
            "search-knowledge": (): CallToolResult => mockSearchKnowledgeResult,
        },
    },
    {
        prompt: "Find information about MongoDB indexes in the knowledge base",
        expectedToolCalls: [
            {
                toolName: "search-knowledge",
                parameters: {
                    query: Matcher.string(),
                    limit: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                    dataSources: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                },
            },
        ],
        mockedTools: {
            "search-knowledge": (): CallToolResult => mockSearchKnowledgeResult,
        },
    },
    {
        prompt: "Look up how to create a compound index in MongoDB docs",
        expectedToolCalls: [
            {
                toolName: "search-knowledge",
                parameters: {
                    query: Matcher.string(),
                    limit: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                    dataSources: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                },
            },
        ],
        mockedTools: {
            "search-knowledge": (): CallToolResult => mockSearchKnowledgeResult,
        },
    },
    {
        prompt: "Search the MongoDB knowledge base for information about replication",
        expectedToolCalls: [
            {
                toolName: "search-knowledge",
                parameters: {
                    query: Matcher.string(),
                    limit: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                    dataSources: Matcher.anyOf(Matcher.undefined, Matcher.anyValue),
                },
            },
        ],
        mockedTools: {
            "search-knowledge": (): CallToolResult => mockSearchKnowledgeResult,
        },
    },
]);
