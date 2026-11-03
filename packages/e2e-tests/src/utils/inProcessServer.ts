import {
    Resources,
    UserConfigSchema,
    createKeychainFromConfig,
    createLoggerFromConfig,
    createRunnerFromConfig,
} from "@mongodb-js/mcp-cli";
import { AllTools, packageInfo } from "mongodb-mcp-server";

export interface InProcessServer {
    /** Full URL of the MCP endpoint (http://127.0.0.1:PORT/mcp). */
    url: string;
    close: () => Promise<void>;
}

export interface InProcessServerOptions {
    /** MongoDB connection string for direct DB access. Omit for an Atlas-API-only server. */
    connectionString?: string;
    /** Atlas Admin API credentials. Omit for a DB-only server. */
    apiClientId?: string;
    apiClientSecret?: string;
    apiBaseUrl?: string;
}

/**
 * Start the MongoDB MCP server in-process over streamable HTTP on a random
 * localhost port, using the same production wiring as the CLI.
 */
export async function startInProcessServer(
    options: InProcessServerOptions = {},
    tools: typeof AllTools = AllTools
): Promise<InProcessServer> {
    const config = UserConfigSchema.parse({
        ...UserConfigSchema.parse({}),
        ...(options.connectionString ? { connectionString: options.connectionString } : {}),
        ...(options.apiClientId ? { apiClientId: options.apiClientId } : {}),
        ...(options.apiClientSecret ? { apiClientSecret: options.apiClientSecret } : {}),
        ...(options.apiBaseUrl ? { apiBaseUrl: options.apiBaseUrl } : {}),
        transport: "http",
        httpHost: "127.0.0.1",
        httpPort: 0, // random port
        telemetry: "disabled",
        loggers: [],
    });

    const keychain = createKeychainFromConfig({ config });
    const logger = await createLoggerFromConfig({ config, keychain });
    const transportRunner = await createRunnerFromConfig({
        config,
        serverMetadata: packageInfo,
        tools,
        resources: Resources,
        logger,
        keychain,
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
