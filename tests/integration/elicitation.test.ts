/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "../../src/server.js";
import { Session } from "../../src/common/session.js";
import { CompositeLogger } from "../../src/common/logger.js";
import { MCPConnectionManager } from "../../src/common/connectionManager.js";
import { DeviceId } from "../../src/helpers/deviceId.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { Keychain } from "../../src/common/keychain.js";
import { InMemoryTransport } from "./inMemoryTransport.js";
import { connectionErrorHandler } from "../../src/common/connectionErrorHandler.js";
import { defaultDriverOptions, type UserConfig } from "../../src/common/config.js";
import { defaultTestConfig } from "./helpers.js";
import { Elicitation } from "../../src/elicitation.js";
import { type MockClientCapabilities, createMockElicitInput } from "../utils/elicitationMocks.js";

describe("Elicitation Integration Tests", () => {
    let mcpClient: Client;
    let mcpServer: Server;
    let deviceId: DeviceId;
    let mockElicitInput: ReturnType<typeof createMockElicitInput>;

    async function setupWithConfig(
        config: Partial<UserConfig> = {},
        clientCapabilities: MockClientCapabilities = {}
    ): Promise<void> {
        const userConfig: UserConfig = {
            ...defaultTestConfig,
            telemetry: "disabled",
            // Add fake API credentials so Atlas tools get registered
            apiClientId: "test-client-id",
            apiClientSecret: "test-client-secret",
            ...config,
        };

        const driverOptions = defaultDriverOptions;
        const logger = new CompositeLogger();
        const exportsManager = ExportsManager.init(userConfig, logger);
        deviceId = DeviceId.create(logger);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const connectionManager = new MCPConnectionManager(userConfig, driverOptions, logger, deviceId);
        const session = new Session({
            apiBaseUrl: userConfig.apiBaseUrl,
            apiClientId: userConfig.apiClientId,
            apiClientSecret: userConfig.apiClientSecret,
            logger,
            exportsManager,
            connectionManager,
            keychain: new Keychain(),
        });
        // Mock API validation for tests
        const mockFn = vi.fn().mockResolvedValue(true);
        session.apiClient.validateAccessToken = mockFn;

        const telemetry = Telemetry.create(session, userConfig, deviceId);

        const clientTransport = new InMemoryTransport();
        const serverTransport = new InMemoryTransport();

        await serverTransport.start();
        await clientTransport.start();

        void clientTransport.output.pipeTo(serverTransport.input);
        void serverTransport.output.pipeTo(clientTransport.input);

        mockElicitInput = createMockElicitInput();

        mcpClient = new Client(
            {
                name: "test-client",
                version: "1.2.3",
            },
            {
                capabilities: clientCapabilities,
            }
        );

        const mockMcpServer = new McpServer({
            name: "test-server",
            version: "5.2.3",
        });

        // Mock the elicitInput method on the server instance
        Object.assign(mockMcpServer.server, { elicitInput: mockElicitInput.mock });

        // Create elicitation instance
        const elicitation = new Elicitation({ server: mockMcpServer.server });

        mcpServer = new Server({
            session,
            userConfig,
            telemetry,
            mcpServer: mockMcpServer,
            connectionErrorHandler,
            elicitation,
        });

        await mcpServer.connect(serverTransport);
        await mcpClient.connect(clientTransport);
    }

    async function cleanup(): Promise<void> {
        await mcpServer?.session.disconnect();
        await mcpClient?.close();
        deviceId?.close();
    }

    afterEach(async () => {
        await cleanup();
        vi.clearAllMocks();
    });

    describe("with elicitation support", () => {
        beforeEach(async () => {
            await setupWithConfig({}, { elicitation: {} });
        });

        describe("tools requiring confirmation", () => {
            it("should request confirmation for drop-database tool and proceed when confirmed", async () => {
                mockElicitInput.confirmYes();

                const result = await mcpClient.callTool({
                    name: "drop-database",
                    arguments: { database: "test-db" },
                });

                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(mockElicitInput.mock).toHaveBeenCalledWith({
                    message: expect.stringContaining("You are about to drop the `test-db` database"),
                    requestedSchema: {
                        type: "object",
                        properties: {
                            confirmation: {
                                type: "string",
                                title: "Would you like to confirm?",
                                description: "Would you like to confirm?",
                                enum: ["Yes", "No"],
                                enumNames: ["Yes, I confirm", "No, I do not confirm"],
                            },
                        },
                        required: ["confirmation"],
                    },
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

                const result = await mcpClient.callTool({
                    name: "drop-database",
                    arguments: { database: "test-db" },
                });

                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(result.isError).toBeFalsy();
                expect(result.content).toEqual([
                    {
                        type: "text",
                        text: "User did not confirm the execution of the `drop-database` tool so the operation was not performed.",
                    },
                ]);
            });

            it("should request confirmation for drop-collection tool", async () => {
                mockElicitInput.confirmYes();

                await mcpClient.callTool({
                    name: "drop-collection",
                    arguments: { database: "test-db", collection: "test-collection" },
                });

                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(mockElicitInput.mock).toHaveBeenCalledWith({
                    message: expect.stringContaining("You are about to drop the `test-collection` collection"),
                    requestedSchema: expect.objectContaining(Elicitation.CONFIRMATION_SCHEMA),
                });
            });

            it("should request confirmation for delete-many tool", async () => {
                mockElicitInput.confirmYes();

                await mcpClient.callTool({
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
                });
            });

            it("should request confirmation for create-db-user tool", async () => {
                mockElicitInput.confirmYes();

                await mcpClient.callTool({
                    name: "atlas-create-db-user",
                    arguments: {
                        projectId: "test-project",
                        username: "test-user",
                        roles: [{ roleName: "read", databaseName: "test-db" }],
                    },
                });

                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(mockElicitInput.mock).toHaveBeenCalledWith({
                    message: expect.stringContaining("You are about to create a database user"),
                    requestedSchema: expect.objectContaining(Elicitation.CONFIRMATION_SCHEMA),
                });
            });

            it("should request confirmation for create-access-list tool", async () => {
                mockElicitInput.confirmYes();

                await mcpClient.callTool({
                    name: "atlas-create-access-list",
                    arguments: {
                        projectId: "test-project",
                        ipAddresses: ["192.168.1.1"],
                    },
                });

                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(mockElicitInput.mock).toHaveBeenCalledWith({
                    message: expect.stringContaining("You are about to add the following entries to the access list"),
                    requestedSchema: expect.objectContaining(Elicitation.CONFIRMATION_SCHEMA),
                });
            });
        });

        describe("tools not requiring confirmation", () => {
            it("should not request confirmation for read operations", async () => {
                const result = await mcpClient.callTool({
                    name: "list-databases",
                    arguments: {},
                });

                expect(mockElicitInput.mock).not.toHaveBeenCalled();
                // Should fail with connection error since we're not connected
                expect(result.isError).toBe(true);
            });

            it("should not request confirmation for find operations", async () => {
                const result = await mcpClient.callTool({
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
    });

    describe("without elicitation support", () => {
        beforeEach(async () => {
            await setupWithConfig({}, {}); // No elicitation capability
        });

        it("should proceed without confirmation for destructive tools when client lacks elicitation support", async () => {
            const result = await mcpClient.callTool({
                name: "drop-database",
                arguments: { database: "test-db" },
            });

            expect(mockElicitInput.mock).not.toHaveBeenCalled();
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
    });

    describe("custom confirmation configuration", () => {
        it("should respect custom confirmationRequiredTools configuration", async () => {
            await setupWithConfig({ confirmationRequiredTools: ["list-databases"] }, { elicitation: {} });

            mockElicitInput.confirmYes();

            await mcpClient.callTool({
                name: "list-databases",
                arguments: {},
            });

            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
        });

        it("should not request confirmation when tool is removed from confirmationRequiredTools", async () => {
            await setupWithConfig(
                { confirmationRequiredTools: [] }, // Empty list
                { elicitation: {} }
            );

            const result = await mcpClient.callTool({
                name: "drop-database",
                arguments: { database: "test-db" },
            });

            expect(mockElicitInput.mock).not.toHaveBeenCalled();
            // Should fail with connection error since we're not connected
            expect(result.isError).toBe(true);
        });

        it("should work with partial confirmation lists", async () => {
            await setupWithConfig(
                { confirmationRequiredTools: ["drop-database"] }, // Only drop-database requires confirmation
                { elicitation: {} }
            );

            mockElicitInput.confirmYes();

            // This should require confirmation
            await mcpClient.callTool({
                name: "drop-database",
                arguments: { database: "test-db" },
            });

            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);

            mockElicitInput.clear();

            // This should not require confirmation
            await mcpClient.callTool({
                name: "drop-collection",
                arguments: { database: "test-db", collection: "test-collection" },
            });

            expect(mockElicitInput.mock).not.toHaveBeenCalled();
        });
    });

    describe("confirmation message content validation", () => {
        beforeEach(async () => {
            await setupWithConfig({}, { elicitation: {} });
        });

        it("should include specific details in create-db-user confirmation", async () => {
            mockElicitInput.confirmYes();

            await mcpClient.callTool({
                name: "atlas-create-db-user",
                arguments: {
                    projectId: "my-project-123",
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
                message: expect.stringMatching(/project.*my-project-123/),
                requestedSchema: expect.objectContaining(Elicitation.CONFIRMATION_SCHEMA),
            });
        });

        it("should include filter details in delete-many confirmation", async () => {
            mockElicitInput.confirmYes();

            await mcpClient.callTool({
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
            });
        });
    });

    describe("error handling in confirmation flow", () => {
        beforeEach(async () => {
            await setupWithConfig({}, { elicitation: {} });
        });

        it("should handle confirmation errors gracefully", async () => {
            mockElicitInput.rejectWith(new Error("Confirmation service unavailable"));

            const result = await mcpClient.callTool({
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
    });
});
