import { describe, expect, it } from "vitest";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expectDefined, validateToolMetadata, getResponseElements } from "../../helpers.js";
import { describeWithAssistant, makeMockAssistantAPI } from "./assistantHelpers.js";

describeWithAssistant("list-knowledge-sources", (integration) => {
    const { mockListSources, mockAPIError, mockNetworkError } = makeMockAssistantAPI();

    validateToolMetadata(
        integration,
        "list-knowledge-sources",
        "List available data sources in the MongoDB Assistant knowledge base",
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

            // Check first data source
            expect(elements[0]?.text).toBe("mongodb-manual");
            expect(elements[0]?._meta).toEqual({
                type: "documentation",
                versions: [
                    { label: "7.0", isCurrent: true },
                    { label: "6.0", isCurrent: false },
                ],
            });

            // Check second data source
            expect(elements[1]?.text).toBe("node-driver");
            expect(elements[1]?._meta).toEqual({
                type: "driver",
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
            expect(response.content).toHaveLength(0);
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
            expect(response.content[0]?.text).toContain("Failed to list knowledge sources: Internal Server Error");
        });

        it("handles network errors", async () => {
            mockNetworkError(new Error("Network connection failed"));

            const response = (await integration
                .mcpClient()
                .callTool({ name: "list-knowledge-sources", arguments: {} })) as CallToolResult;

            expect(response.isError).toBe(true);
            expectDefined(response.content);
            expect(response.content[0]).toHaveProperty("text");
            expect(response.content[0]?.text).toContain("Network connection failed");
        });
    });
});
