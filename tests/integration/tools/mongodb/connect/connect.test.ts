import { describeWithMongoDB } from "../mongodbHelpers.js";
import {
    getResponseContent,
    getResponseElements,
    validateThrowsForInvalidArguments,
    validateToolMetadata,
} from "../../../helpers.js";
import { defaultTestConfig } from "../../../helpers.js";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";

describeWithMongoDB(
    "SwitchConnection tool",
    (integration) => {
        beforeEach(async () => {
            await integration.mcpServer().session.connectToMongoDB({
                connectionString: integration.connectionString(),
            });
        });

        validateToolMetadata(
            integration,
            "switch-connection",
            "Switch to a different MongoDB connection. If the user has configured a connection string or has previously called the connect tool, a connection is already established and there's no need to call this tool unless the user has explicitly requested to switch to a new instance.",
            "connect",
            [
                {
                    name: "connectionString",
                    description: "MongoDB connection string to switch to (in the mongodb:// or mongodb+srv:// format)",
                    type: "string",
                    required: false,
                },
            ]
        );

        validateThrowsForInvalidArguments(integration, "switch-connection", [{ connectionString: 123 }]);

        describe("without arguments", () => {
            it("connects to the database", async () => {
                const response = await integration.mcpClient().callTool({ name: "switch-connection" });
                const content = getResponseContent(response.content);
                expect(content).toContain("Successfully connected");
            });
        });

        it("doesn't have the connect tool registered", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const tool = tools.find((tool) => tool.name === "connect");
            expect(tool).toBeUndefined();
        });

        it("defaults to the connection string from config", async () => {
            const response = await integration.mcpClient().callTool({ name: "switch-connection", arguments: {} });
            const content = getResponseContent(response.content);
            expect(content).toContain("Successfully connected");
        });

        it("switches to the connection string from the arguments", async () => {
            const newConnectionString = `${integration.connectionString()}?appName=foo-bar`;
            const response = await integration.mcpClient().callTool({
                name: "switch-connection",
                arguments: {
                    connectionString: newConnectionString,
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("Successfully connected");
        });

        describe("when the argument connection string is invalid", () => {
            it("returns error message", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "switch-connection",
                    arguments: {
                        connectionString: "mangobd://localhost:12345",
                    },
                });

                const content = getResponseContent(response.content);

                expect(content).toContain("The configured connection string is not valid.");
            });
        });
    },
    {
        getUserConfig: (mdbIntegration) => ({
            ...defaultTestConfig,
            connectionString: mdbIntegration.connectionString(),
        }),
    }
);

describeWithMongoDB(
    "SwitchConnection tool with overridden metadata",
    (integration) => {
        beforeEach(async () => {
            await integration.mcpServer().session.connectToMongoDB({
                connectionString: integration.connectionString(),
            });
        });

        validateToolMetadata(integration, "new-switch-connection", "new description", "connect", [
            {
                name: "connectionString",
                description: "MongoDB connection string to switch to (in the mongodb:// or mongodb+srv:// format)",
                type: "string",
                required: false,
            },
        ]);

        validateThrowsForInvalidArguments(integration, "new-switch-connection", [{ connectionString: 123 }]);

        it("should not contain overridden tools", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const tool = tools.find((tool) => tool.name === "switch-connection");
            expect(tool).toBeUndefined();
        });

        it("should not contain connect tool", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const tool = tools.find((tool) => tool.name === "connect");
            expect(tool).toBeUndefined();
        });

        it("connects to the configured connection", async () => {
            const response = await integration.mcpClient().callTool({ name: "new-switch-connection" });
            const content = getResponseContent(response.content);
            expect(content).toContain("Successfully connected");
        });

        it("connects to the provided connection", async () => {
            const newConnectionString = `${integration.connectionString()}?appName=foo-bar`;
            const response = await integration.mcpClient().callTool({
                name: "new-switch-connection",
                arguments: {
                    connectionString: newConnectionString,
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("Successfully connected");
        });
    },
    {
        getUserConfig: (mdbIntegration) => ({
            ...defaultTestConfig,
            connectionString: mdbIntegration.connectionString(),
            toolMetadataOverrides: {
                "switch-connection": {
                    name: "new-switch-connection",
                    description: "new description",
                },
            },
        }),
    }
);

describeWithMongoDB(
    "SwitchConnection tool when server is configured to connect with complex connection",
    (integration) => {
        let connectFnSpy: MockInstance<typeof NodeDriverServiceProvider.connect>;
        beforeEach(async () => {
            connectFnSpy = vi.spyOn(NodeDriverServiceProvider, "connect");
            await integration.mcpServer().session.connectToMongoDB({
                connectionString: integration.connectionString(),
            });
        });

        it("should be able to connect to next connection and not use the connect options of the connection setup during server boot", async () => {
            const newConnectionString = `${integration.connectionString()}`;
            // Note: The connect function is called with OIDC options for the
            // configured string
            expect(connectFnSpy).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining(`${integration.connectionString()}/?directConnection=true`),
                expect.objectContaining({
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    oidc: expect.objectContaining({ openBrowser: { command: "not-a-browser" } }),
                }),
                undefined,
                expect.anything()
            );
            const response = await integration.mcpClient().callTool({
                name: "switch-connection",
                arguments: {
                    connectionString: newConnectionString,
                },
            });

            const content = getResponseContent(response.content);
            // The connection will still be connected because the --browser
            // option only sets the command to be used when opening the browser
            // for OIDC handling.
            expect(content).toContain("Successfully connected");

            // Now that we're connected lets verify the config
            // Note: The connect function is called with OIDC options for the
            // configured string
            expect(connectFnSpy).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining(`${integration.connectionString()}`),
                expect.not.objectContaining({
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    oidc: expect.objectContaining({ openBrowser: { command: "not-a-browser" } }),
                }),
                undefined,
                expect.anything()
            );
        });
    },
    {
        getUserConfig: (mdbIntegration) => ({
            ...defaultTestConfig,
            // Setting browser in config is the same as passing `--browser` CLI
            // argument to the MCP server CLI entry point. We expect that the
            // further connection attempts stay detached from the connection
            // options passed during server boot, in this case browser.
            browser: "not-a-browser",
            connectionString: `${mdbIntegration.connectionString()}/?directConnection=true`,
        }),
    }
);

describeWithMongoDB("Connect tool", (integration) => {
    validateToolMetadata(
        integration,
        "connect",
        "Connect to a MongoDB instance. The config resource captures if the server is already connected to a MongoDB cluster. If the user has configured a connection string or has previously called the connect tool, a connection is already established and there's no need to call this tool unless the user has explicitly requested to switch to a new MongoDB cluster.",
        "connect",
        [
            {
                name: "connectionString",
                description: "MongoDB connection string (in the mongodb:// or mongodb+srv:// format)",
                type: "string",
                required: true,
            },
        ]
    );

    validateThrowsForInvalidArguments(integration, "connect", [{}, { connectionString: 123 }]);

    it("doesn't have the switch-connection tool registered", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const tool = tools.find((tool) => tool.name === "switch-connection");
        expect(tool).toBeUndefined();
    });

    describe("with connection string", () => {
        it("connects to the database", async () => {
            const response = await integration.mcpClient().callTool({
                name: "connect",
                arguments: {
                    connectionString: integration.connectionString(),
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("Successfully connected");
        });
    });

    describe("with invalid connection string", () => {
        it("returns error message", async () => {
            const response = await integration.mcpClient().callTool({
                name: "connect",
                arguments: { connectionString: "mangodb://localhost:12345" },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("The configured connection string is not valid.");

            // Should not suggest using the config connection string (because we don't have one)
            expect(content).not.toContain("Your config lists a different connection string");
        });
    });
});

describeWithMongoDB(
    "Connect tool when disabled",
    (integration) => {
        it("is not suggested when querying MongoDB disconnected", async () => {
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: { database: "some-db", collection: "some-collection" },
            });

            const elements = getResponseElements(response);
            expect(elements).toHaveLength(2);
            expect(elements[0]?.text).toContain(
                "You need to connect to a MongoDB instance before you can access its data."
            );
            expect(elements[1]?.text).toContain(
                "There are no tools available to connect. Please update the configuration to include a connection string and restart the server."
            );
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            disabledTools: ["connect"],
        }),
    }
);

describeWithMongoDB(
    "Connect tool with overridden metadata",
    (integration) => {
        validateToolMetadata(integration, "new-connect", "new connect tool description", "connect", [
            {
                name: "connectionString",
                description: "MongoDB connection string (in the mongodb:// or mongodb+srv:// format)",
                type: "string",
                required: true,
            },
        ]);

        validateThrowsForInvalidArguments(integration, "new-connect", [{}, { connectionString: 123 }]);

        it("should not have switch-connection tool registered", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const tool = tools.find((tool) => tool.name === "switch-connection");
            expect(tool).toBeUndefined();
        });

        it("should not have overridden connect tool registered", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const tool = tools.find((tool) => tool.name === "connect");
            expect(tool).toBeUndefined();
        });

        it("should be able to work the same as connect tool", async () => {
            const response = await integration.mcpClient().callTool({
                name: "new-connect",
                arguments: {
                    connectionString: integration.connectionString(),
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("Successfully connected");
        });
    },
    {
        getUserConfig() {
            return {
                ...defaultTestConfig,
                toolMetadataOverrides: {
                    connect: {
                        name: "new-connect",
                        description: "new connect tool description",
                    },
                },
            };
        },
    }
);

describeWithMongoDB(
    "with both connect and switch-connection metadata overridden",
    (integration) => {
        it("should be able to connect and switch connection using overridden tool metadata", async () => {
            // Original switch-connection and connect are not there
            let { tools } = await integration.mcpClient().listTools();
            let switchConnection = tools.find((tool) => tool.name === "switch-connection");
            let connect = tools.find((tool) => tool.name === "connect");
            expect(switchConnection).toBeUndefined();
            expect(connect).toBeUndefined();

            // Establish connection
            let response = await integration.mcpClient().callTool({
                name: "new-connect",
                arguments: {
                    connectionString: integration.connectionString(),
                },
            });
            let content = getResponseContent(response.content);
            expect(content).toContain("Successfully connected");

            // Now check again
            ({ tools } = await integration.mcpClient().listTools());
            switchConnection = tools.find((tool) => tool.name === "switch-connection");
            connect = tools.find((tool) => tool.name === "connect");
            expect(switchConnection).toBeUndefined();
            expect(connect).toBeUndefined();

            // Switch using new tool
            response = await integration.mcpClient().callTool({
                name: "new-switch-connection",
                arguments: {
                    connectionString: `${integration.connectionString()}?appName=foo-bar`,
                },
            });
            content = getResponseContent(response.content);
            expect(content).toContain("Successfully connected");
        });
    },
    {
        getUserConfig() {
            return {
                ...defaultTestConfig,
                toolMetadataOverrides: {
                    connect: {
                        name: "new-connect",
                        description: "new connect tool description",
                    },
                    "switch-connection": {
                        name: "new-switch-connection",
                        description: "new switch connection tool description",
                    },
                },
            };
        },
    }
);
