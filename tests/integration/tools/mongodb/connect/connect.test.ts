import { describeWithMongoDB } from "../mongodbHelpers.js";
import {
    connect,
    getResponseContent,
    getResponseElements,
    validateThrowsForInvalidArguments,
    validateToolMetadata,
} from "../../../helpers.js";
import { defaultTestConfig } from "../../../helpers.js";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { PRECONFIGURED_CONNECTION_ID } from "../../../../../src/common/connectionRegistry.js";

describeWithMongoDB(
    "Connect tool with a configured connection string",
    (integration) => {
        it("seeds a preconfigured connection", async () => {
            const response = await integration.mcpClient().callTool({ name: "list-connections", arguments: {} });
            const structuredContent = response.structuredContent as {
                connections: { connectionId: string; source: string; state?: string }[];
            };

            expect(structuredContent.connections).toHaveLength(1);
            expect(structuredContent.connections[0]?.connectionId).toBe(PRECONFIGURED_CONNECTION_ID);
            expect(structuredContent.connections[0]?.source).toBe("preconfigured");
        });

        it("creates an additional, independent connection when the connect tool is called", async () => {
            const connectionId = await connect(integration.mcpClient(), integration.connectionString());
            expect(connectionId).not.toBe(PRECONFIGURED_CONNECTION_ID);

            const response = await integration.mcpClient().callTool({ name: "list-connections", arguments: {} });
            const structuredContent = response.structuredContent as {
                connections: { connectionId: string }[];
            };
            expect(structuredContent.connections.map((connection) => connection.connectionId)).toIncludeSameMembers([
                PRECONFIGURED_CONNECTION_ID,
                connectionId,
            ]);
        });

        it("rejects the reserved preconfigured connection name", async () => {
            const response = await integration.mcpClient().callTool({
                name: "connect",
                arguments: {
                    connectionString: integration.connectionString(),
                    connectionName: PRECONFIGURED_CONNECTION_ID,
                },
            });

            expect(response.isError).toBe(true);
            const content = getResponseContent(response.content);
            expect(content).toContain("-32602");
            expect(content).toContain("reserved connection name");
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
    "Connect tool when server is configured to connect with complex connection",
    (integration) => {
        let connectFnSpy: MockInstance<typeof NodeDriverServiceProvider.connect>;
        beforeEach(async () => {
            connectFnSpy = vi.spyOn(NodeDriverServiceProvider, "connect");
            // Dial the preconfigured connection seeded from the configured connection string.
            await integration.mcpServer().session.connectionRegistry.resolve(PRECONFIGURED_CONNECTION_ID);
        });

        it("should connect to the provided connection string while applying user config driver options", async () => {
            const newConnectionString = `${integration.connectionString()}`;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const expectedDriverOptions = expect.objectContaining({
                applyProxyToOIDC: true,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                oidc: expect.objectContaining({ openBrowser: { command: "not-a-browser" } }),
                productDocsLink: "https://github.com/mongodb-js/mongodb-mcp-server/",
                productName: "MongoDB MCP",
                proxy: { useEnvironmentVariableProxies: true },
            });

            expect(connectFnSpy).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining(`${integration.connectionString()}/?directConnection=true`),
                expectedDriverOptions,
                undefined,
                expect.anything()
            );
            const response = await integration.mcpClient().callTool({
                name: "connect",
                arguments: {
                    connectionString: newConnectionString,
                },
            });

            const content = getResponseContent(response.content);
            // The connection will still be connected because the --browser
            // option only sets the command to be used when opening the browser
            // for OIDC handling.
            expect(content).toContain("Successfully connected");

            expect(connectFnSpy).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining(`${integration.connectionString()}`),
                expectedDriverOptions,
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
        'Connect to a MongoDB instance and get back a connectionId to pass to the other MongoDB tools. Each call establishes a new, independent connection — multiple connections can be active at the same time. If the server was started with a configured connection string, a connection with the id "preconfigured" already exists and there is no need to call this tool to use it.',
        "connect",
        [
            {
                name: "connectionString",
                description: "MongoDB connection string (in the mongodb:// or mongodb+srv:// format)",
                type: "string",
                required: true,
            },
            {
                name: "connectionName",
                description:
                    'Optional short label for the connection (stored slugified with a short suffix, e.g. "staging" becomes staging-<suffix>). Shown by list-connections; helpful for telling multiple connections apart.',
                type: "string",
                required: false,
            },
        ]
    );

    validateThrowsForInvalidArguments(integration, "connect", [{}, { connectionString: 123 }]);

    it("registers the connection management tools", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const toolNames = tools.map((tool) => tool.name);
        expect(toolNames).toContain("connect");
        expect(toolNames).toContain("disconnect");
        expect(toolNames).toContain("list-connections");
    });

    describe("with connection string", () => {
        it("connects to the database and returns a connectionId", async () => {
            const response = await integration.mcpClient().callTool({
                name: "connect",
                arguments: {
                    connectionString: integration.connectionString(),
                },
            });
            expect(response.structuredContent).toEqual({ connectionId: expect.any(String) as string });
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
            expect(response.structuredContent).toBeUndefined();
        });
    });
});

describeWithMongoDB(
    "Connect tool when disabled",
    (integration) => {
        it("is not suggested when querying MongoDB with an unknown connectionId", async () => {
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    connectionId: "unknown-connection-id",
                    database: "some-db",
                    collection: "some-collection",
                },
            });

            const elements = getResponseElements(response);
            expect(elements).toHaveLength(2);
            expect(elements[0]?.text).toContain('Connection "unknown-connection-id" does not exist or has expired.');
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
