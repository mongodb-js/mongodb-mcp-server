import { describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    expectDefined,
    validateToolMetadata,
    getResponseElements,
    getDataFromUntrustedContent,
} from "../../integration/helpers.js";
import { describeWithAssistant, makeMockAssistantAPI } from "./assistantHelpers.js";
import { parse as yamlParse } from "yaml";

// Mock the devtools-proxy-support module
vi.mock("@mongodb-js/devtools-proxy-support", () => ({
    createFetch: vi.fn(),
}));

describeWithAssistant("list-knowledge-sources", (integration) => {
    const { mockListSources, mockAPIError, mockNetworkError } = makeMockAssistantAPI();

    validateToolMetadata(
        integration,
        "list-knowledge-sources",
        "List available data sources in the MongoDB Assistant knowledge base. Use this to explore available data sources or to find search filter parameters to use in search-knowledge.",
        "read",
        []
    );

    describe("happy path", () => {
        it("returns list of data sources with metadata", async () => {
            const mockSources = [
                {
                    id: "mongodb-manual",
                    type: "documentation",
                    versions: [
                        { label: "7.0", isCurrent: true },
                        { label: "6.0", isCurrent: false },
                    ],
                },
                {
                    id: "node-driver",
                    type: "driver",
                    versions: [
                        { label: "6.0", isCurrent: true },
                        { label: "5.0", isCurrent: false },
                    ],
                },
            ];

            mockListSources(mockSources);

            const response = (await integration
                .mcpClient()
                .callTool({ name: "list-knowledge-sources", arguments: {} })) as CallToolResult;

            expect(response.isError).toBeFalsy();
            expect(response.content).toBeInstanceOf(Array);
            expect(response.content).toHaveLength(2);

            const elements = getResponseElements(response.content);

            expect(elements[0]?.text).toBe("Found 2 data sources in the MongoDB Assistant knowledge base.");
            expect(elements[1]?.text).toContain("<untrusted-user-data-");
            const yamlData = getDataFromUntrustedContent(elements[1]?.text ?? "");
            const dataSources = yamlParse(yamlData) as Array<Record<string, unknown>>;

            expect(dataSources[0]).toMatchObject({
                id: "mongodb-manual",
                type: "documentation",
                currentVersion: "7.0",
                versions: [
                    { label: "7.0", isCurrent: true },
                    { label: "6.0", isCurrent: false },
                ],
            });

            expect(dataSources[1]).toMatchObject({
                id: "node-driver",
                type: "driver",
                currentVersion: "6.0",
                versions: [
                    { label: "6.0", isCurrent: true },
                    { label: "5.0", isCurrent: false },
                ],
            });
        });

        it("handles empty data sources list", async () => {
            mockListSources([]);

            const response = (await integration
                .mcpClient()
                .callTool({ name: "list-knowledge-sources", arguments: {} })) as CallToolResult;

            expect(response.isError).toBeFalsy();
            expect(response.content).toBeInstanceOf(Array);
            expect(response.content).toHaveLength(2);

            const elements = getResponseElements(response.content);
            expect(elements[0]?.text).toBe("Found 0 data sources in the MongoDB Assistant knowledge base.");
        });
    });

    describe("error handling", () => {
        it("handles API error responses", async () => {
            mockAPIError(500, "Internal Server Error");

            const response = (await integration
                .mcpClient()
                .callTool({ name: "list-knowledge-sources", arguments: {} })) as CallToolResult;

            expect(response.isError).toBe(true);
            expectDefined(response.content);
            expect(response.content[0]).toHaveProperty("text");
            expect((response.content[0] as { text: string }).text).toContain(
                "Failed to list knowledge sources: Internal Server Error"
            );
        });

        it("handles network errors", async () => {
            mockNetworkError(new Error("Network connection failed"));

            const response = (await integration
                .mcpClient()
                .callTool({ name: "list-knowledge-sources", arguments: {} })) as CallToolResult;

            expect(response.isError).toBe(true);
            expectDefined(response.content);
            expect(response.content[0]).toHaveProperty("text");
            expect((response.content[0] as { text: string }).text).toContain("Network connection failed");
        });
    });
});
