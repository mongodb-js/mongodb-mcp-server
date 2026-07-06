import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import { ListDBUsersTool } from "./listDBUsers.js";
import type { ISession } from "@mongodb-js/mcp-types";
import type { ITelemetry } from "@mongodb-js/mcp-types";
import type { Elicitation } from "@mongodb-js/mcp-core";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";

describe("ListDBUsersTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: ListDBUsersTool;

    beforeEach(() => {
        mockApiClient = {
            listDatabaseUsers: vi.fn(),
        };

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        const mockSession = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
        } as unknown as ISession;

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as ITelemetry;

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams = {
            name: ListDBUsersTool.toolName,
            category: "atlas",
            operationType: ListDBUsersTool.operationType,
            session: mockSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new ListDBUsersTool(params);
    });

    const baseArgs = { projectId: "507f1f77bcf86cd799439011" };
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["execute"](args as never, { signal: new AbortController().signal } as never);

    it("returns database users when they exist", async () => {
        mockApiClient.listDatabaseUsers!.mockResolvedValue({
            results: [
                {
                    username: "alice",
                    roles: [{ roleName: "readWrite", databaseName: "admin" }],
                    scopes: [{ type: "CLUSTER", name: "my-cluster" }],
                },
            ],
        });

        const result = await exec({ ...baseArgs });

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain(`Found 1 database users in project ${baseArgs.projectId}`);
        expect(text).toContain("alice");
        expect(text).toContain("<untrusted-user-data-");
    });

    it("returns empty message when no users found", async () => {
        mockApiClient.listDatabaseUsers!.mockResolvedValue({ results: [] });

        const result = await exec({ ...baseArgs });

        expect((result.content[0] as { text: string }).text).toBe(" No database users found");
    });

    it("passes projectId to API", async () => {
        mockApiClient.listDatabaseUsers!.mockResolvedValue({ results: [] });

        await exec({ ...baseArgs });

        expect(mockApiClient.listDatabaseUsers).toHaveBeenCalledWith(
            {
                params: {
                    path: { groupId: baseArgs.projectId },
                },
            },
            expect.anything()
        );
    });

    it("handles null results gracefully", async () => {
        mockApiClient.listDatabaseUsers!.mockResolvedValue({ results: null });

        const result = await exec({ ...baseArgs });

        expect((result.content[0] as { text: string }).text).toBe(" No database users found");
    });

    it("omits collectionName from roles when not set", async () => {
        mockApiClient.listDatabaseUsers!.mockResolvedValue({
            results: [
                {
                    username: "bob",
                    roles: [{ roleName: "read", databaseName: "app" }],
                    scopes: [],
                },
            ],
        });

        const result = await exec({ ...baseArgs });

        expect(result.structuredContent?.users[0]?.roles[0]).toEqual({
            roleName: "read",
            databaseName: "app",
        });
        expect(result.structuredContent?.users[0]?.roles[0]).not.toHaveProperty("collectionName");
    });

    it("includes collectionName in roles when set", async () => {
        mockApiClient.listDatabaseUsers!.mockResolvedValue({
            results: [
                {
                    username: "carol",
                    roles: [{ roleName: "read", databaseName: "app", collectionName: "orders" }],
                    scopes: [],
                },
            ],
        });

        const result = await exec({ ...baseArgs });

        expect(result.structuredContent?.users[0]?.roles[0]).toEqual({
            roleName: "read",
            databaseName: "app",
            collectionName: "orders",
        });
    });

    describe("structuredContent", () => {
        it("returns users and totalCount on success", async () => {
            mockApiClient.listDatabaseUsers!.mockResolvedValue({
                results: [
                    {
                        username: "alice",
                        roles: [{ roleName: "readWrite", databaseName: "admin" }],
                        scopes: [{ type: "CLUSTER", name: "my-cluster" }],
                    },
                    {
                        username: "bob",
                        roles: [{ roleName: "read", databaseName: "app", collectionName: "items" }],
                        scopes: [{ type: "DATA_LAKE", name: "lake-1" }],
                    },
                ],
            });

            const result = await exec({ ...baseArgs });

            expect(result.structuredContent).toEqual({
                projectId: baseArgs.projectId,
                users: [
                    {
                        username: "alice",
                        roles: [{ roleName: "readWrite", databaseName: "admin" }],
                        scopes: [{ type: "CLUSTER", name: "my-cluster" }],
                    },
                    {
                        username: "bob",
                        roles: [{ roleName: "read", databaseName: "app", collectionName: "items" }],
                        scopes: [{ type: "DATA_LAKE", name: "lake-1" }],
                    },
                ],
                totalCount: 2,
            });
        });

        it("returns empty users when no results", async () => {
            mockApiClient.listDatabaseUsers!.mockResolvedValue({ results: [] });

            const result = await exec({ ...baseArgs });

            expect(result.structuredContent).toEqual({
                projectId: baseArgs.projectId,
                users: [],
                totalCount: 0,
            });
        });

        it("omits structuredContent on error paths", async () => {
            mockApiClient.listDatabaseUsers!.mockRejectedValue(new Error("API failure"));

            await expect(exec({ ...baseArgs })).rejects.toThrow("API failure");
        });
    });
});
