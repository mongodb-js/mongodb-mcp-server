import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { InMemoryTransport } from "../../integration/inMemoryTransport.js";
import { defaultTestConfig } from "../../integration/helpers.js";
import { Session } from "../../../src/session.js";
import { Telemetry } from "../../../src/telemetry/telemetry.js";
import { Server } from "../../../src/server.js";

export async function discoverMongoDBTools(): Promise<Tool[]> {
    let mcpClient: Client | undefined;
    let mcpServer: Server | undefined;
    try {
        const serverTransport = new InMemoryTransport();
        const clientTransport = new InMemoryTransport();

        await serverTransport.start();
        await clientTransport.start();

        void serverTransport.output.pipeTo(clientTransport.input);
        void clientTransport.output.pipeTo(serverTransport.input);

        const session = new Session({
            apiBaseUrl: defaultTestConfig.apiBaseUrl,
        });

        const telemetry = Telemetry.create(session, defaultTestConfig);

        mcpClient = new Client(
            {
                name: "tool-discovery-client",
                version: "0.0.0",
            },
            {
                capabilities: {},
            }
        );

        mcpServer = new Server({
            session,
            userConfig: defaultTestConfig,
            telemetry,
            mcpServer: new McpServer({
                name: "test-server",
                version: "5.2.3",
            }),
        });

        await mcpServer.connect(serverTransport);
        await mcpClient.connect(clientTransport);

        return (await mcpClient.listTools()).tools;
    } finally {
        await mcpClient?.close();
        await mcpServer?.session?.close();
        await mcpServer?.close();
    }
}
