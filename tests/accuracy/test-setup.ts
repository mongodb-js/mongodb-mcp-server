import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { OllamaModel /*, GeminiModel, OpenAIModel*/ } from "./sdk/models/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "../integration/inMemoryTransport.js";
import { Session } from "../../src/session.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { defaultTestConfig } from "../integration/helpers.js";
import { Server } from "../../src/server.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Helper to have test suites verify against models that we expect.
 */
export const eachModel = describe.each([
    new OllamaModel("llama3.1"),
    // new GeminiModel("gemini-2.0-flash"),
    // new OpenAIModel("gpt-4o-mini"),
]);

/**
 * Helper to discover tools exposed by an MCP server.
 *
 * @param transport Transport to connect to the MCP server
 */
export async function discoverMCPTools(transport: Transport): Promise<Tool[]> {
    const discoveryClient = new Client(
        {
            name: "mdb-tool-discovery-client",
            version: "0.0.0",
        },
        {
            capabilities: {},
        }
    );
    await discoveryClient.connect(transport);
    return (await discoveryClient.listTools()).tools;
}

/**
 * Helper to dynamically discover tools from our MongoDB MCP server
 */
export async function discoverMongoDBMCPTools(): Promise<Tool[]> {
    const clientTransport = new InMemoryTransport();
    const serverTransport = new InMemoryTransport();

    await serverTransport.start();
    await clientTransport.start();

    void clientTransport.output.pipeTo(serverTransport.input);
    void serverTransport.output.pipeTo(clientTransport.input);

    const session = new Session({
        apiBaseUrl: defaultTestConfig.apiBaseUrl,
    });

    const telemetry = Telemetry.create(session, defaultTestConfig);

    const mcpServer = new Server({
        session,
        userConfig: defaultTestConfig,
        telemetry,
        mcpServer: new McpServer({
            name: "test-server",
            version: "5.2.3",
        }),
    });
    await mcpServer.connect(serverTransport);
    return discoverMCPTools(clientTransport);
}
