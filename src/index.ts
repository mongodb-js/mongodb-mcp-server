#!/usr/bin/env node

import logger, { LogId } from "./logger.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { Session } from "./session.js";
import { Server } from "./server.js";
import { packageInfo } from "./helpers/packageInfo.js";
import { Telemetry } from "./telemetry/telemetry.js";
import { createEJsonTransport } from "./helpers/EJsonTransport.js";

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

    if (config.transportType === "http" || config.transportType === "sse") {
        const app = express();
        app.use(express.json());

        // Map to store transports by session ID
        const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

        // Handle POST requests for client-to-server communication
        app.post("/mcp", async (req, res) => {
            // Check for existing session ID
            const sessionId = req.headers["mcp-session-id"] as string | undefined;
            let transport: StreamableHTTPServerTransport;

            if (sessionId && transports[sessionId]) {
                // Reuse existing transport
                transport = transports[sessionId];
            } else if (!sessionId && isInitializeRequest(req.body)) {
                // New initialization request
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (sessionId: string) => {
                        // Store the transport by session ID
                        transports[sessionId] = transport;
                    },
                });

                // Clean up transport when closed
                transport.onclose = () => {
                    if (transport.sessionId) {
                        delete transports[transport.sessionId];
                    }
                };

                // Connect to the MCP server
                await server.connect(transport);
            } else {
                // Invalid request
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32000,
                        message: "Bad Request: No valid session ID provided",
                    },
                    id: null,
                });
                return;
            }

            // Handle the request
            await transport.handleRequest(req, res, req.body);
        });

        // Reusable handler for GET and DELETE requests
        const handleSessionRequest = async (req: express.Request, res: express.Response) => {
            const sessionId = req.headers["mcp-session-id"] as string | undefined;
            if (!sessionId || !transports[sessionId]) {
                res.status(400).send("Invalid or missing session ID");
                return;
            }

            const transport = transports[sessionId];
            await transport.handleRequest(req, res);
        };

        // Handle GET requests for server-to-client notifications via SSE
        app.get("/mcp", handleSessionRequest);

        // Handle DELETE requests for session termination
        app.delete("/mcp", handleSessionRequest);
        const PORT = config.port;
        app.listen(PORT);
    } else {
        const transport = createEJsonTransport();

    process.on("SIGINT", () => {
        logger.info(LogId.serverCloseRequested, "server", `Server close requested`);

        server
            .close()
            .then(() => {
                logger.info(LogId.serverClosed, "server", `Server closed successfully`);
                process.exit(0);
            })
            .catch((err: unknown) => {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.error(LogId.serverCloseFailure, "server", `Error closing server: ${error.message}`);
                process.exit(1);
            });
    });
        await server.connect(transport);
    }
} catch (error: unknown) {
    logger.emergency(LogId.serverStartFailure, "server", `Fatal error running server: ${error as string}`);
    process.exit(1);
}
