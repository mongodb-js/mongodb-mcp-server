import { describeWithMongoDB } from "../mongodbHelpers.js";
import { getResponseContent, validateThrowsForInvalidArguments, validateToolMetadata } from "../../../helpers.js";
import { config } from "../../../../../src/config.js";

describeWithMongoDB(
    "switchConnection tool",
    (integration) => {
        beforeEach(() => {
            integration.mcpServer().userConfig.connectionString = integration.connectionString();
        });

        validateToolMetadata(
            integration,
            "switch-connection",
            "Switch to a different MongoDB connection. If the user has configured a connection string or has previously called the connect tool, a connection is already established and there's no need to call this tool unless the user has explicitly requested to switch to a new instance.",
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

        describe("when the arugment connection string is invalid", () => {
            it("returns error message", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "switch-connection",
                    arguments: {
                        connectionString: "mongodb://localhost:12345",
                    },
                });

                const content = getResponseContent(response.content);

                expect(content).toContain("Error running switch-connection");
            });
        });
    },
    (mdbIntegration) => ({
        ...config,
        connectionString: mdbIntegration.connectionString(),
    })
);
describeWithMongoDB(
    "Connect tool",
    (integration) => {
        validateToolMetadata(integration, "connect", "Connect to a MongoDB instance", [
            {
                name: "connectionString",
                description: "MongoDB connection string (in the mongodb:// or mongodb+srv:// format)",
                type: "string",
                required: true,
            },
        ]);

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
                    arguments: { connectionString: "mongodb://localhost:12345" },
                });
                const content = getResponseContent(response.content);
                expect(content).toContain("Error running connect");

                // Should not suggest using the config connection string (because we don't have one)
                expect(content).not.toContain("Your config lists a different connection string");
            });
        });
    },
    () => config
);
