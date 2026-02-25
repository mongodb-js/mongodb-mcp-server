import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { type MockedTools } from "./sdk/accuracyTestingClient.js";
import { ListKnowledgeSourcesToolName } from "../../src/tools/assistant/listKnowledgeSources.js";
import { SearchKnowledgeToolName } from "../../src/tools/assistant/searchKnowledge.js";

export const mockListKnowledgeSourcesResult: CallToolResult = {
    content: [
        {
            type: "text",
            text: "Found 3 data sources in the MongoDB Assistant knowledge base.",
        },
        {
            type: "text",
            text: `<untrusted-user-data-mock>{"dataSources":[{"id":"mongodb-university-ilt-meta","versions":[],"type":"university-content"},{"id":"pymongo","versions":[{"label":"v4.8","isCurrent":false},{"label":"v4.7","isCurrent":false},{"label":"v4.15","isCurrent":false},{"label":"v4.11","isCurrent":false},{"label":"v4.14","isCurrent":false},{"label":"v4.9","isCurrent":false},{"label":"v4.12","isCurrent":false},{"label":"v4.16 (current)","isCurrent":true},{"label":"v4.10","isCurrent":false},{"label":"v4.13","isCurrent":false},{"label":"upcoming","isCurrent":false}],"type":"tech-docs"},{"id":"resources","versions":[],"type":"marketing"},{"id":"services","versions":[],"type":"marketing"},{"id":"kotlin-sync","versions":[{"label":"v5.4","isCurrent":false},{"label":"v5.2","isCurrent":false},{"label":"v5.3","isCurrent":false},{"label":"upcoming","isCurrent":false},{"label":"v5.6 (current)","isCurrent":true},{"label":"v5.5","isCurrent":false}],"type":"tech-docs"},{"id":"ops-manager","versions":[{"label":"Version 8.0 (current)","isCurrent":true},{"label":"Upcoming","isCurrent":false},{"label":"Version 7.0","isCurrent":false}],"type":"tech-docs"},{"id":"java","versions":[{"label":"v5.4","isCurrent":false},{"label":"v5.3","isCurrent":false},{"label":"v5.2","isCurrent":false},{"label":"upcoming","isCurrent":false},{"label":"v5.6 (current)","isCurrent":true},{"label":"v5.5","isCurrent":false}],"type":"tech-docs"},{"id":"ruby-driver","versions":[{"label":"upcoming","isCurrent":false}],"type":"tech-docs"},{"id":"mcp-server","versions":[{"label":"main","isCurrent":true}],"type":"tech-docs"},{"id":"entity-framework","versions":[{"label":"v8.1","isCurrent":false},{"label":"v8.3","isCurrent":false},{"label":"v9.0 (current)","isCurrent":true},{"label":"v8.0","isCurrent":false},{"label":"v8.2","isCurrent":false},{"label":"upcoming","isCurrent":false}],"type":"tech-docs"},{"id":"university-skills","versions":[],"type":"university-content"},{"id":"comparisons","versions":[],"type":"marketing"},{"id":"database-tools","versions":[{"label":"main","isCurrent":true}],"type":"tech-docs"},{"id":"spark-connector","versions":[{"label":"v10.6","isCurrent":false},{"label":"v10.3","isCurrent":false},{"label":"upcoming","isCurrent":false},{"label":"v10.4","isCurrent":false},{"label":"v10.5","isCurrent":false},{"label":"v11.0 (current)","isCurrent":true}],"type":"tech-docs"},{"id":"kafka-connector","versions":[{"label":"v2.0 (current)","isCurrent":true},{"label":"v1.14","isCurrent":false},{"label":"v1.16","isCurrent":false},{"label":"v1.13","isCurrent":false},{"label":"upcoming","isCurrent":false},{"label":"v1.15","isCurrent":false}],"type":"tech-docs"},{"id":"c","versions":[{"label":"v2.1","isCurrent":false},{"label":"v1.29","isCurrent":false},{"label":"v1.28","isCurrent":false},{"label":"v1.27","isCurrent":false},{"label":"v2.2 (current)","isCurrent":true},{"label":"v2.0","isCurrent":false},{"label":"v1.30","isCurrent":false},{"label":"v1.26","isCurrent":false},{"label":"upcoming","isCurrent":false}],"type":"tech-docs"},{"id":"cloud-docs","versions":[{"label":"main","isCurrent":true}],"type":"tech-docs"},{"id":"devcenter","versions":[],"type":"devcenter"},{"id":"web-legal","versions":[]},{"id":"golang","versions":[{"label":"v2.1","isCurrent":false},{"label":"v1.12","isCurrent":false},{"label":"upcoming","isCurrent":false},{"label":"v2.3","isCurrent":false},{"label":"v2.4","isCurrent":false},{"label":"v2.0","isCurrent":false},{"label":"v1.14","isCurrent":false},{"label":"v2.2","isCurrent":false},{"label":"v1.15","isCurrent":false},{"label":"v1.17","isCurrent":false},{"label":"v1.13","isCurrent":false},{"label":"v1.16","isCurrent":false}],"type":"tech-docs"},{"id":"django","versions":[{"label":"v5.2","isCurrent":false},{"label":"upcoming","isCurrent":false}],"type":"tech-docs"},{"id":"bi-connector","versions":[{"label":"2.14","isCurrent":true}],"type":"tech-docs"},{"id":"php-library","versions":[{"label":"v2.x (current)","isCurrent":true},{"label":"v1.x","isCurrent":false},{"label":"upcoming","isCurrent":false}],"type":"tech-docs"},{"id":"csharp","versions":[{"label":"v2.30","isCurrent":false},{"label":"v3.1","isCurrent":false},{"label":"v3.6 (current)","isCurrent":true},{"label":"v3.2","isCurrent":false},{"label":"v3.4","isCurrent":false},{"label":"v3.3","isCurrent":false},{"label":"v3.5","isCurrent":false},{"label":"v3.0","isCurrent":false},{"label":"upcoming","isCurrent":false}],"type":"tech-docs"},{"id":"web-misc","versions":[],"type":"marketing-misc"},{"id":"mongodb-university-web","versions":[],"type":"university-content"},{"id":"wired-tiger","versions":[],"type":"tech-docs-external"},{"id":"kotlin","versions":[{"label":"v5.4","isCurrent":false},{"label":"v5.3","isCurrent":false},{"label":"v5.2","isCurrent":false},{"label":"upcoming","isCurrent":false},{"label":"v5.5","isCurrent":false},{"label":"v5.6 (current)","isCurrent":true}],"type":"tech-docs"},{"id":"visual-studio-extension","versions":[{"label":"v2.0 (current)","isCurrent":true},{"label":"v1.5","isCurrent":false},{"label":"upcoming","isCurrent":false}],"type":"tech-docs"},{"id":"solutions","versions":[],"type":"marketing"},{"id":"compass","versions":[{"label":"latest stable","isCurrent":true}],"type":"tech-docs"},{"id":"mongodb-vscode","versions":[{"label":"main","isCurrent":true}],"type":"tech-docs"},{"id":"charts","versions":[{"label":"main","isCurrent":true}],"type":"tech-docs"},{"id":"voyageai-api-spec","versions":[],"type":"tech-docs"},{"id":"mongoose","versions":[],"type":"tech-docs-external"},{"id":"cloud-manager","versions":[{"label":"current","isCurrent":true}],"type":"tech-docs"},{"id":"pymongo-arrow","versions":[{"label":"v1.5","isCurrent":false},{"label":"v1.10","isCurrent":false},{"label":"v1.11","isCurrent":false},{"label":"v1.4","isCurrent":false},{"label":"v1.3","isCurrent":false},{"label":"v1.7","isCurrent":false},{"label":"v1.6","isCurrent":false},{"label":"upcoming","isCurrent":false},{"label":"v1.8","isCurrent":false},{"label":"v1.9","isCurrent":false}],"type":"tech-docs"},{"id":"mongodb-university","versions":[],"type":"university-content"},{"id":"scala","versions":[{"label":"v5.3","isCurrent":false},{"label":"v5.2","isCurrent":false},{"label":"upcoming","isCurrent":false},{"label":"v5.6 (current)","isCurrent":true},{"label":"v5.5","isCurrent":false},{"label":"v5.4","isCurrent":false}],"type":"tech-docs"},{"id":"atlas-architecture","versions":[{"label":"v20260204 (current)","isCurrent":true}],"type":"tech-docs"},{"id":"atlas-cli","versions":[{"label":"v1.49","isCurrent":false},{"label":"v1.51.0","isCurrent":true},{"label":"v1.46","isCurrent":false},{"label":"v1.48","isCurrent":false},{"label":"v1.47","isCurrent":false},{"label":"v1.50","isCurrent":false},{"label":"upcoming","isCurrent":false}],"type":"tech-docs"},{"id":"mck","versions":[{"label":"upcoming","isCurrent":false},{"label":"v1.3.0","isCurrent":false},{"label":"v1.5.0","isCurrent":false},{"label":"v1.2.0","isCurrent":false},{"label":"v1.7.0 (current)","isCurrent":true},{"label":"v1.4.0","isCurrent":false},{"label":"v1.6.0","isCurrent":false},{"label":"v1.1.0","isCurrent":false}],"type":"tech-docs"},{"id":"landing","versions":[{"label":"main","isCurrent":true}],"type":"tech-docs"},{"id":"docs","versions":[{"label":"7.0","isCurrent":false},{"label":"8.2 (Current)","isCurrent":true},{"label":"8.0","isCurrent":false}],"type":"tech-docs"},{"id":"mongodb-shell","versions":[{"label":"main","isCurrent":true}],"type":"tech-docs"},{"id":"intellij","versions":[{"label":"main","isCurrent":true}],"type":"tech-docs"},{"id":"voyageai-blog","versions":[],"type":"marketing"},{"id":"prisma","versions":[],"type":"tech-docs-external"},{"id":"mongosync","versions":[{"label":"v1.17","isCurrent":false},{"label":"v1.13","isCurrent":false},{"label":"v1.16","isCurrent":false},{"label":"1.10","isCurrent":false},{"label":"v1.18","isCurrent":false},{"label":"v1.11","isCurrent":false},{"label":"v1.15","isCurrent":false},{"label":"v1.12","isCurrent":false},{"label":"v1.14","isCurrent":false}],"type":"tech-docs"},{"id":"mongocli","versions":[{"label":"2.0.6 (current)","isCurrent":true},{"label":"2.1 (upcoming)","isCurrent":false}],"type":"tech-docs"},{"id":"mongodb-corp","versions":[]},{"id":"practical-aggregations-book","versions":[],"type":"book-external"},{"id":"university-meta","versions":[],"type":"university-content"},{"id":"cpp-driver","versions":[{"label":"upcoming","isCurrent":false},{"label":"v3.10","isCurrent":false},{"label":"v3.11","isCurrent":false},{"label":"v4.0","isCurrent":false},{"label":"v4.1 (current)","isCurrent":true}],"type":"tech-docs"},{"id":"blog","versions":[],"type":"marketing"},{"id":"atlas-operator","versions":[{"label":"v2.12","isCurrent":false},{"label":"v2.13 (current)","isCurrent":true},{"label":"upcoming","isCurrent":false},{"label":"v2.11","isCurrent":false}],"type":"tech-docs"},{"id":"laravel","versions":[{"label":"upcoming","isCurrent":false},{"label":"v5.x (current)","isCurrent":true},{"label":"v4.x","isCurrent":false}],"type":"tech-docs"},{"id":"java-rs","versions":[{"label":"v5.4","isCurrent":false},{"label":"v5.3","isCurrent":false},{"label":"v5.2","isCurrent":false},{"label":"upcoming","isCurrent":false},{"label":"v5.6 (current)","isCurrent":true},{"label":"v5.5","isCurrent":false}],"type":"tech-docs"},{"id":"voyageai-docs","versions":[],"type":"tech-docs"},{"id":"drivers","versions":[{"label":"main","isCurrent":true}],"type":"tech-docs"},{"id":"docs-k8s-operator","versions":[{"label":"Version 1.32","isCurrent":false},{"label":"Version 1.31","isCurrent":false},{"label":"Version v1.33","isCurrent":true}],"type":"tech-docs"},{"id":"node","versions":[{"label":"upcoming","isCurrent":false},{"label":"v6.19","isCurrent":false},{"label":"v6.20","isCurrent":false},{"label":"v6.16","isCurrent":false},{"label":"v6.14","isCurrent":false},{"label":"v6.15","isCurrent":false},{"label":"v6.17","isCurrent":false},{"label":"v7.0 (current)","isCurrent":true},{"label":"v6.21","isCurrent":false},{"label":"v6.18","isCurrent":false},{"label":"v6.13","isCurrent":false}],"type":"tech-docs"},{"id":"company","versions":[],"type":"marketing"},{"id":"rust","versions":[{"label":"v3.1","isCurrent":false},{"label":"v2.8","isCurrent":false},{"label":"v3.2","isCurrent":false},{"label":"v2.7","isCurrent":false},{"label":"v3.3","isCurrent":false},{"label":"v3.5 (current)","isCurrent":true},{"label":"v3.4","isCurrent":false},{"label":"v3.0","isCurrent":false},{"label":"upcoming","isCurrent":false}],"type":"tech-docs"},{"id":"atlas-terraform-provider","versions":[],"type":"tech-docs-external"},{"id":"mongoid","versions":[{"label":"upcoming","isCurrent":false},{"label":"v9.0 (current)","isCurrent":true}],"type":"tech-docs"},{"id":"docs-relational-migrator","versions":[{"label":"main","isCurrent":true}],"type":"tech-docs"},{"id":"cloudgov","versions":[{"label":"main","isCurrent":true}],"type":"tech-docs"},{"id":"products","versions":[],"type":"marketing"}]}</untrusted-user-data-mock>`,
        },
    ],
};

const mockedTools: MockedTools = {
    [SearchKnowledgeToolName]: (): CallToolResult => mockListKnowledgeSourcesResult,
    [ListKnowledgeSourcesToolName]: (): CallToolResult => mockListKnowledgeSourcesResult,
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
        mockedTools,
    },
    {
        prompt: "List the available knowledge bases for MongoDB",
        expectedToolCalls: [
            {
                toolName: "list-knowledge-sources",
                parameters: {},
            },
        ],
        mockedTools,
    },
    {
        prompt: "What data sources can I search for MongoDB information?",
        expectedToolCalls: [
            {
                toolName: "list-knowledge-sources",
                parameters: {},
            },
        ],
        mockedTools,
    },
    {
        prompt: "Which MongoDB versions have documentation available?",
        expectedToolCalls: [
            {
                toolName: "list-knowledge-sources",
                parameters: {},
            },
        ],
        mockedTools,
    },
]);
