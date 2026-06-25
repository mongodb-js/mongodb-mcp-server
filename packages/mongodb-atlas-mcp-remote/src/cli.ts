#!/usr/bin/env node

import { Readable } from "node:stream";
import { createFetch, systemCA } from "@mongodb-js/devtools-proxy-support";
import type { AuthProvider, FetchLike, JSONRPCMessage } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server";
import { loadConfig, ConfigurationError } from "./config.js";
import { TokenManager, TokenError } from "./tokenManager.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
    let config;
    try {
        config = loadConfig();
    } catch (error) {
        if (error instanceof ConfigurationError) {
            // Logger not configured yet, write to stderr directly.
            process.stderr.write(`${error.message}\n`);
            process.exit(1);
        }
        throw error;
    }

    logger.setLevel(config.logLevel);

    try {
        await systemCA();
    } catch (error) {
        logger.warning(`Failed to load system CA certificates: ${String(error)}`);
    }

    const proxyFetch = createFetch({ useEnvironmentVariableProxies: true }) as unknown as FetchLike;

    const tokenManager = new TokenManager(
        config.tokenUrl,
        config.clientId,
        config.clientSecret,
        config.tokenTimeoutMs,
        proxyFetch
    );

    const authProvider: AuthProvider = {
        token: (): Promise<string> => tokenManager.getToken(),
        onUnauthorized: (): Promise<void> => {
            tokenManager.invalidateToken();
            return Promise.resolve();
        },
    };

    try {
        await tokenManager.getToken();
    } catch (error) {
        const message = error instanceof TokenError ? error.message : String(error);
        logger.error(`Failed to acquire access token: ${message}`);
        process.exit(1);
    }

    const httpTransport = new StreamableHTTPClientTransport(new URL(config.remoteUrl), {
        authProvider,
        fetch: toWebStreamFetch(proxyFetch),
    });

    const stdioTransport = new StdioServerTransport();

    httpTransport.onmessage = (message: JSONRPCMessage): void => {
        void stdioTransport.send(message);
    };

    stdioTransport.onmessage = (message: JSONRPCMessage): void => {
        // Catch errors here rather than in httpTransport.onerror so we can access the message id.
        void httpTransport.send(message).catch((error: unknown) => {
            if ("id" in message) {
                void stdioTransport.send({
                    jsonrpc: "2.0",
                    id: message.id,
                    error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
                });
            }
        });
    };
    stdioTransport.onerror = (error: Error): void => {
        logger.error("Stdio transport error", { error: String(error) });
    };
    stdioTransport.onclose = (): void => {
        process.exit(0);
    };

    const shutdown = (): void => {
        logger.info("Shutting down");
        void httpTransport.close();
        void stdioTransport.close();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGABRT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("SIGQUIT", shutdown);

    await httpTransport.start();
    await stdioTransport.start();
}

main().catch((error) => {
    process.stderr.write(`Fatal error: ${String(error)}\n`);
    process.exit(1);
});

// devtools-proxy-support uses node-fetch, which has a node Readable response body.
// The SDK's SSE parser calls pipeThrough(), which only exists on Web ReadableStream.
// This wrapper converts the response body so the SDK can consume it.
function toWebStreamFetch(baseFetch: FetchLike): FetchLike {
    return async (url, init): Promise<Response> => {
        const res = await baseFetch(url, init);
        if (res.body === null) return res;
        return new Response(Readable.toWeb(res.body as unknown as Readable) as ReadableStream, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
        });
    };
}
