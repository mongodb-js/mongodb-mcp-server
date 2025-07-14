import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { config } from "../common/config.js";
import logger, { LogId } from "../common/logger.js";

const JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED = -32000;

export function createHttpTransport(): StreamableHTTPServerTransport {
    const app = express();
    app.enable("trust proxy"); // needed for reverse proxy support
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });

    app.post("/mcp", async (req: express.Request, res: express.Response) => {
        try {
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            logger.error(
                LogId.streamableHttpTransportRequestFailure,
                "streamableHttpTransport",
                `Error handling request: ${error instanceof Error ? error.message : String(error)}`
            );
            res.status(400).json({
                jsonrpc: "2.0",
                error: {
                    code: JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
                    message: `Error handling request: ${error instanceof Error ? error.message : String(error)}`,
                },
            });
        }
    });

    app.get("/mcp", async (req: express.Request, res: express.Response) => {
        try {
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            logger.error(
                LogId.streamableHttpTransportRequestFailure,
                "streamableHttpTransport",
                `Error handling request: ${error instanceof Error ? error.message : String(error)}`
            );
            res.status(400).json({
                jsonrpc: "2.0",
                error: {
                    code: JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
                    message: `Error handling request: ${error instanceof Error ? error.message : String(error)}`,
                },
            });
        }
    });

    app.delete("/mcp", async (req: express.Request, res: express.Response) => {
        try {
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            logger.error(
                LogId.streamableHttpTransportRequestFailure,
                "streamableHttpTransport",
                `Error handling request: ${error instanceof Error ? error.message : String(error)}`
            );
            res.status(400).json({
                jsonrpc: "2.0",
                error: {
                    code: JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
                    message: `Error handling request: ${error instanceof Error ? error.message : String(error)}`,
                },
            });
        }
    });

    const server = app.listen(config.httpPort, config.httpHost, () => {
        logger.info(
            LogId.streamableHttpTransportStarted,
            "streamableHttpTransport",
            `Server started on http://${config.httpHost}:${config.httpPort}`
        );
    });

    transport.onclose = () => {
        logger.info(LogId.streamableHttpTransportCloseRequested, "streamableHttpTransport", `Closing server`);
        server.close((err?: Error) => {
            if (err) {
                logger.error(
                    LogId.streamableHttpTransportCloseFailure,
                    "streamableHttpTransport",
                    `Error closing server: ${err.message}`
                );
                return;
            }
            logger.info(LogId.streamableHttpTransportCloseSuccess, "streamableHttpTransport", `Server closed`);
        });
    };

    return transport;
}
