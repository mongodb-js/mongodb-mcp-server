import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

// Mock response for the list-knowledge-sources tool
const mockListKnowledgeSourcesResult: CallToolResult = {
    content: [
        {
            type: "text",
            text: "Found 3 data sources in the MongoDB Assistant knowledge base.",
        },
        {
            type: "text",
            text: `<untrusted-user-data-mock>
- id: mongodb-manual
  type: documentation
  currentVersion: "8.0"
  versions:
    - label: "8.0"
      isCurrent: true
    - label: "7.0"
      isCurrent: false
- id: node-driver
  type: driver
  currentVersion: "6.0"
  versions:
    - label: "6.0"
      isCurrent: true
- id: pymongo
  type: driver
  currentVersion: "4.0"
  versions:
    - label: "4.0"
      isCurrent: true
</untrusted-user-data-mock>`,
        },
    ],
};

describeAccuracyTests([
    {
        prompt: "What MongoDB documentation sources are available?",
        expectedToolCalls: [
            {
                toolName: "list-knowledge-sources",
                parameters: {},
            },
        ],
        mockedTools: {
            "list-knowledge-sources": (): CallToolResult => mockListKnowledgeSourcesResult,
        },
    },
    {
        prompt: "List the available knowledge bases for MongoDB",
        expectedToolCalls: [
            {
                toolName: "list-knowledge-sources",
                parameters: {},
            },
        ],
        mockedTools: {
            "list-knowledge-sources": (): CallToolResult => mockListKnowledgeSourcesResult,
        },
    },
    {
        prompt: "What data sources can I search for MongoDB information?",
        expectedToolCalls: [
            {
                toolName: "list-knowledge-sources",
                parameters: {},
            },
        ],
        mockedTools: {
            "list-knowledge-sources": (): CallToolResult => mockListKnowledgeSourcesResult,
        },
    },
    {
        prompt: "What information is available about MongoDB Atlas Stream Processing?",
        expectedToolCalls: [
            {
                toolName: "list-knowledge-sources",
                parameters: {},
            },
        ],
        mockedTools: {
            "list-knowledge-sources": (): CallToolResult => mockListKnowledgeSourcesResult,
        },
    },
]);
