import express from "express";
import http from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Runner } from "./base.js";
import { config } from "../common/config.js";
import logger, { LogId } from "../common/logger.js";

const JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED = -32000;
const JSON_RPC_ERROR_CODE_METHOD_NOT_ALLOWED = -32601;

function promiseHandler(
    fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>
) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
        fn(req, res, next).catch(next);
    };
}

export class StreamableHttpRunner extends Runner {
    private httpServer: http.Server | undefined;

    async run() {
        const app = express();
        app.enable("trust proxy"); // needed for reverse proxy support
        app.use(express.urlencoded({ extended: true }));
        app.use(express.json());

        app.post(
            "/mcp",
            promiseHandler(async (req: express.Request, res: express.Response) => {
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: undefined,
                });

                const server = this.setupServer();

                await server.connect(transport);

                res.on("close", async () => {
                    try {
                        await transport.close();
                    } catch (error: unknown) {
                        logger.error(
                            LogId.streamableHttpTransportCloseFailure,
                            "streamableHttpTransport",
                            `Error closing transport: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                    try {
                        await server.close();
                    } catch (error: unknown) {
                        logger.error(
                            LogId.streamableHttpTransportCloseFailure,
                            "streamableHttpTransport",
                            `Error closing server: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                });

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
                            message: `failed to handle request`,
                            data: error instanceof Error ? error.message : String(error),
                        },
                    });
                }
            })
        );

        app.get(
            "/mcp",
            promiseHandler(async (req: express.Request, res: express.Response) => {
                res.status(405).json({
                    jsonrpc: "2.0",
                    error: {
                        code: JSON_RPC_ERROR_CODE_METHOD_NOT_ALLOWED,
                        message: `method not allowed`,
                    },
                });
            })
        );

        app.delete(
            "/mcp",
            promiseHandler(async (req: express.Request, res: express.Response) => {
                res.status(405).json({
                    jsonrpc: "2.0",
                    error: {
                        code: JSON_RPC_ERROR_CODE_METHOD_NOT_ALLOWED,
                        message: `method not allowed`,
                    },
                });
            })
        );

        this.httpServer = await new Promise<http.Server>((resolve, reject) => {
            const result = app.listen(config.httpPort, config.httpHost, (err?: Error) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(result);
            });
        });

        logger.info(
            LogId.streamableHttpTransportStarted,
            "streamableHttpTransport",
            `Server started on http://${config.httpHost}:${config.httpPort}`
        );
    }

    async close(): Promise<number> {
        try {
            await this.httpServer?.close();
            return 0;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(LogId.serverCloseFailure, "server", `Error closing server: ${err.message}`);
            return 1;
        }
    }
}
