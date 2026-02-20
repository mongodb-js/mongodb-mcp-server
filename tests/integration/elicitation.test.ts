/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, afterEach } from "vitest";
import { type UserConfig } from "../../src/common/config/userConfig.js";
import { defaultTestConfig } from "./helpers.js";
import { Elicitation } from "../../src/elicitation.js";
import { createMockElicitInput } from "../utils/elicitationMocks.js";
import { describeWithMongoDB } from "./tools/mongodb/mongodbHelpers.js";

function createTestConfig(config: Partial<UserConfig> = {}): UserConfig {
    return {
        ...defaultTestConfig,
        // Add fake API credentials so Atlas tools get registered
        apiClientId: "test-client-id",
        apiClientSecret: "test-client-secret",
        ...config,
    };
}

describe("Elicitation Integration Tests", () => {
    const mockElicitInput = createMockElicitInput();
    afterEach(() => {
        mockElicitInput.clear();
    });

    describeWithMongoDB(
        "with elicitation support",
        (integration) => {
            describe("tools requiring confirmation by default", () => {
                it("should request confirmation for drop-database tool and proceed when confirmed", async () => {
                    mockElicitInput.confirmYes();

                    const result = await integration.mcpClient().callTool({
                        name: "drop-database",
                        arguments: { database: "test-db" },
                    });

                    expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                    expect(mockElicitInput.mock).toHaveBeenCalledWith({
                        message: expect.stringContaining("You are about to drop the `test-db` database"),
                        requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                        mode: "form",
                    });

                    // Should attempt to execute (will fail due to no connection, but confirms flow worked)
                    expect(result.isError).toBe(true);
                    expect(result.content).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({
                                type: "text",
                                text: expect.stringContaining("You need to connect to a MongoDB instance"),
                            }),
                        ])
                    );
                });

                it("should not proceed when user declines confirmation", async () => {
                    mockElicitInput.confirmNo();

                    const result = await integration.mcpClient().callTool({
                        name: "drop-database",
                        arguments: { database: "test-db" },
                    });

                    expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                    expect(result.isError).toBeTruthy();
                    expect(result.content).toEqual([
                        {
                            type: "text",
                            text: "User did not confirm the execution of the `drop-database` tool so the operation was not performed.",
                        },
                    ]);
                });

                it("should request confirmation for drop-collection tool", async () => {
                    mockElicitInput.confirmYes();

                    await integration.mcpClient().callTool({
                        name: "drop-collection",
                        arguments: { database: "test-db", collection: "test-collection" },
                    });

                    expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                    expect(mockElicitInput.mock).toHaveBeenCalledWith({
                        message: expect.stringContaining("You are about to drop the `test-collection` collection"),
                        requestedSchema: expect.objectContaining(Elicitation.CONFIRMATION_SCHEMA),
                        mode: "form",
                    });
                });

                it("should request confirmation for delete-many tool", async () => {
                    mockElicitInput.confirmYes();

                    await integration.mcpClient().callTool({
                        name: "delete-many",
                        arguments: {
                            database: "test-db",
                            collection: "test-collection",
                            filter: { status: "inactive" },
                        },
                    });

                    expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                    expect(mockElicitInput.mock).toHaveBeenCalledWith({
                        message: expect.stringContaining("You are about to delete documents"),
                        requestedSchema: expect.objectContaining(Elicitation.CONFIRMATION_SCHEMA),
                        mode: "form",
                    });
                });

                it("should request confirmation for create-db-user tool", async () => {
                    mockElicitInput.confirmYes();

                    await integration.mcpClient().callTool({
                        name: "atlas-create-db-user",
                        arguments: {
                            projectId: "507f1f77bcf86cd799439011", // Valid 24-char hex string
                            username: "test-user",
                            roles: [{ roleName: "read", databaseName: "test-db" }],
                        },
                    });

                    expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                    expect(mockElicitInput.mock).toHaveBeenCalledWith({
                        message: expect.stringContaining("You are about to create a database user"),
                        requestedSchema: expect.objectContaining(Elicitation.CONFIRMATION_SCHEMA),
                        mode: "form",
                    });
                });

                it("should request confirmation for create-access-list tool", async () => {
                    mockElicitInput.confirmYes();

                    await integration.mcpClient().callTool({
                        name: "atlas-create-access-list",
                        arguments: {
                            projectId: "507f1f77bcf86cd799439011", // Valid 24-char hex string
                            ipAddresses: ["192.168.1.1"],
                        },
                    });

                    expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                    expect(mockElicitInput.mock).toHaveBeenCalledWith({
                        message: expect.stringContaining(
                            "You are about to add the following entries to the access list"
                        ),
                        requestedSchema: expect.objectContaining(Elicitation.CONFIRMATION_SCHEMA),
                        mode: "form",
                    });
                });
            });

            describe("tools not requiring confirmation by default", () => {
                it("should not request confirmation for read operations", async () => {
                    const result = await integration.mcpClient().callTool({
                        name: "list-databases",
                        arguments: {},
                    });

                    expect(mockElicitInput.mock).not.toHaveBeenCalled();
                    // Should fail with connection error since we're not connected
                    expect(result.isError).toBe(true);
                });

                it("should not request confirmation for find operations", async () => {
                    const result = await integration.mcpClient().callTool({
                        name: "find",
                        arguments: {
                            database: "test-db",
                            collection: "test-collection",
                        },
                    });

                    expect(mockElicitInput.mock).not.toHaveBeenCalled();
                    // Should fail with connection error since we're not connected
                    expect(result.isError).toBe(true);
                });
            });
        },
        {
            getUserConfig: () => createTestConfig(),
            getMockElicitationInput: () => mockElicitInput,
        }
    );

    describeWithMongoDB(
        "without elicitation support",
        (integration) => {
            it("should proceed without confirmation for default confirmation-required tools when client lacks elicitation support", async () => {
                const result = await integration.mcpClient().callTool({
                    name: "drop-database",
                    arguments: { database: "test-db" },
                });

                // Note: No mock assertions needed since elicitation is disabled
                // Should fail with connection error since we're not connected, but confirms flow bypassed confirmation
                expect(result.isError).toBe(true);
                expect(result.content).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            type: "text",
                            text: expect.stringContaining("You need to connect to a MongoDB instance"),
                        }),
                    ])
                );
            });
        },
        {
            getUserConfig: () => createTestConfig(),
            getClientCapabilities: () => ({}),
        }
    );

    describeWithMongoDB(
        "custom confirmation configuration",
        (integration) => {
            it("should confirm with a generic message with custom configurations for other tools", async () => {
                mockElicitInput.confirmYes();

                await integration.mcpClient().callTool({
                    name: "list-databases",
                    arguments: {},
                });

                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(mockElicitInput.mock).toHaveBeenCalledWith({
                    message: expect.stringMatching(
                        /You are about to execute the `list-databases` tool which requires additional confirmation. Would you like to proceed\?/
                    ),
                    requestedSchema: expect.objectContaining(Elicitation.CONFIRMATION_SCHEMA),
                    mode: "form",
                });
            });

            it("should not request confirmation when tool is removed from default confirmationRequiredTools", async () => {
                const result = await integration.mcpClient().callTool({
                    name: "drop-database",
                    arguments: { database: "test-db" },
                });

                expect(mockElicitInput.mock).not.toHaveBeenCalled();
                // Should fail with connection error since we're not connected
                expect(result.isError).toBe(true);
            });
        },
        {
            getUserConfig: () => createTestConfig({ confirmationRequiredTools: ["list-databases"] }),
            getMockElicitationInput: () => mockElicitInput,
        }
    );

    describeWithMongoDB(
        "confirmation message content validation",
        (integration) => {
            it("should include specific details in create-db-user confirmation", async () => {
                mockElicitInput.confirmYes();

                await integration.mcpClient().callTool({
                    name: "atlas-create-db-user",
                    arguments: {
                        projectId: "507f1f77bcf86cd799439011", // Valid 24-char hex string
                        username: "myuser",
                        password: "mypassword",
                        roles: [
                            { roleName: "readWrite", databaseName: "mydb" },
                            { roleName: "read", databaseName: "logs", collectionName: "events" },
                        ],
                        clusters: ["cluster1", "cluster2"],
                    },
                });

                expect(mockElicitInput.mock).toHaveBeenCalledWith({
                    message: expect.stringMatching(/project.*507f1f77bcf86cd799439011/),
                    requestedSchema: expect.objectContaining(Elicitation.CONFIRMATION_SCHEMA),
                    mode: "form",
                });
            });

            it("should include filter details in delete-many confirmation", async () => {
                mockElicitInput.confirmYes();

                await integration.mcpClient().callTool({
                    name: "delete-many",
                    arguments: {
                        database: "mydb",
                        collection: "users",
                        filter: { status: "inactive", lastLogin: { $lt: "2023-01-01" } },
                    },
                });

                expect(mockElicitInput.mock).toHaveBeenCalledWith({
                    message: expect.stringMatching(/mydb.*database/),
                    requestedSchema: expect.objectContaining(Elicitation.CONFIRMATION_SCHEMA),
                    mode: "form",
                });
            });
        },
        {
            getUserConfig: () => createTestConfig(),
            getMockElicitationInput: () => mockElicitInput,
        }
    );

    describeWithMongoDB(
        "error handling in confirmation flow",
        (integration) => {
            it("should handle confirmation errors gracefully", async () => {
                mockElicitInput.rejectWith(new Error("Confirmation service unavailable"));

                const result = await integration.mcpClient().callTool({
                    name: "drop-database",
                    arguments: { database: "test-db" },
                });

                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(result.isError).toBe(true);
                expect(result.content).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            type: "text",
                            text: expect.stringContaining("Error running drop-database"),
                        }),
                    ])
                );
            });
        },
        {
            getUserConfig: () => createTestConfig(),
            getMockElicitationInput: () => mockElicitInput,
        }
    );
});
