#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import logger, { LogId } from "./logger.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config.js";
import { Session } from "./session.js";
import { Server } from "./server.js";
import { packageInfo } from "./helpers/packageInfo.js";
import { Telemetry } from "./telemetry/telemetry.js";

try {
    const session = new Session({
        apiBaseUrl: config.apiBaseUrl,
        apiClientId: config.apiClientId,
        apiClientSecret: config.apiClientSecret,
    });
    const mcpServer = new McpServer({
        name: packageInfo.mcpServerName,
        version: packageInfo.version,
    });

    const telemetry = Telemetry.create(session, config);

    const server = new Server({
        mcpServer,
        session,
        telemetry,
        userConfig: config,
    });

    const transport = new StdioServerTransport();

    await server.connect(transport);
} catch (error: unknown) {
    logger.emergency(LogId.serverStartFailure, "server", `Fatal error running server: ${error as string}`);
    process.exit(1);
}
