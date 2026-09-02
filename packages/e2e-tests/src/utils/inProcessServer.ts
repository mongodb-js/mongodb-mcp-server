import { Keychain } from "@mongodb-js/mcp-core";
import { Resources, UserConfigSchema, createLoggerFromConfig, createRunnerFromConfig } from "@mongodb-js/mcp-cli";
import { AllTools, packageInfo } from "mongodb-mcp-server";

export interface InProcessServer {
    /** Full URL of the MCP endpoint (http://127.0.0.1:PORT/mcp). */
    url: string;
    close: () => Promise<void>;
}

/**
 * Start the MongoDB MCP server in-process over streamable HTTP on a random
 * localhost port, using the same production wiring as the CLI.
 */
export async function startInProcessServer(connectionString: string): Promise<InProcessServer> {
    const config = UserConfigSchema.parse({
        ...UserConfigSchema.parse({}),
        connectionString,
        transport: "http",
        httpHost: "127.0.0.1",
        httpPort: 0, // random port
        telemetry: "disabled",
        loggers: [],
    });

    const logger = await createLoggerFromConfig({ config, keychain: Keychain.root });
    const transportRunner = await createRunnerFromConfig({
        config,
        serverMetadata: packageInfo,
        tools: AllTools,
        resources: Resources,
        logger,
    });

    // The runner is a StreamableHttpRunner for transport=http.
    const httpRunner = transportRunner as unknown as {
        start(): Promise<void>;
        close(): Promise<void>;
        mcpHttpServer: { serverAddress: string };
    };

    await httpRunner.start();
    const address = httpRunner.mcpHttpServer.serverAddress;
    return {
        url: `${address}/mcp`,
        close: () => httpRunner.close(),
    };
}
