#!/usr/bin/env node

import { Readable } from "node:stream";
import { createFetch, systemCA } from "@mongodb-js/devtools-proxy-support";
import type { AuthProvider, FetchLike, JSONRPCMessage } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server";
import { loadConfig, ConfigurationError } from "./config.js";
import { TokenManager, TokenError } from "./tokenManager.js";
import { logger, addSecret } from "./logger.js";
import { LogId } from "./logging/index.js";

async function main(): Promise<void> {
    let config;
    try {
        config = loadConfig();
    } catch (error) {
        if (error instanceof ConfigurationError) {
            logger.error({ id: LogId.configError, context: "cli", message: error.message });
            process.exit(1);
        }
        throw error;
    }

    addSecret(config.clientId);
    addSecret(config.clientSecret);

    try {
        await systemCA();
    } catch (error) {
        logger.warning({
            id: LogId.systemCaWarning,
            context: "cli",
            message: `Failed to load system CA certificates: ${String(error)}`,
        });
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
        logger.error({
            id: LogId.tokenFetchError,
            context: "cli",
            message: `Failed to acquire access token: ${message}`,
        });
        process.exit(1);
    }

    const httpTransport = new StreamableHTTPClientTransport(new URL(config.remoteUrl), {
        authProvider,
        fetch: toWebStreamFetch(proxyFetch),
    });

    const stdioTransport = new StdioServerTransport();

    let sessionLogged = false;
    httpTransport.onmessage = (message: JSONRPCMessage): void => {
        // The remote assigns the session id on the initialize response; log it once for correlation.
        if (!sessionLogged && httpTransport.sessionId !== undefined) {
            sessionLogged = true;
            logger.debug({
                id: LogId.sessionInfo,
                context: "cli",
                message: "Remote MCP session established",
                attributes: { sessionId: httpTransport.sessionId },
            });
        }
        void stdioTransport.send(message);
    };

    stdioTransport.onmessage = (message: JSONRPCMessage): void => {
        const method = "method" in message ? message.method : undefined;
        const messageId = "id" in message ? message.id : undefined;

        logger.debug({
            id: LogId.messageForwarded,
            context: "cli",
            message: "Forwarding message to remote MCP server",
            attributes: messageAttributes(method, messageId),
        });

        // Catch errors at the send call so we can log the request context (method/id) and reply with the id.
        void httpTransport.send(message).catch((error: unknown) => {
            const { code, status } = extractSdkError(error);
            logger.error({
                id: LogId.httpSendError,
                context: "cli",
                message: "Failed to forward message to remote MCP server",
                attributes: {
                    ...messageAttributes(method, messageId),
                    // Prefer the structured code/status over error.message, which carries the raw response body.
                    ...(code !== undefined ? { code } : {}),
                    ...(status !== undefined ? { status: String(status) } : {}),
                    // Only include the error text when there is no HTTP status (network/timeout errors carry no body).
                    ...(status === undefined
                        ? { error: error instanceof Error ? error.message : String(error) }
                        : {}),
                },
            });

            if (messageId !== undefined) {
                void stdioTransport.send({
                    jsonrpc: "2.0",
                    id: messageId,
                    error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
                });
            }
        });
    };
    stdioTransport.onerror = (error: Error): void => {
        logger.error({
            id: LogId.stdioTransportError,
            context: "cli",
            message: "Stdio transport error",
            attributes: { error: String(error) },
        });
    };
    stdioTransport.onclose = (): void => {
        process.exit(0);
    };

    const shutdown = (): void => {
        logger.info({ id: LogId.shutdown, context: "cli", message: "Shutting down" });
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

// Builds redaction-safe log attributes from a JSON-RPC message: metadata only, no params/body.
function messageAttributes(method: unknown, id: unknown): Record<string, string> {
    return {
        ...(method !== undefined ? { method: String(method) } : {}),
        ...(id !== undefined ? { id: String(id) } : {}),
    };
}

// Extracts the SDK error's code and HTTP status without touching error.message (which carries the response body).
function extractSdkError(error: unknown): { code?: string; status?: number } {
    if (typeof error === "object" && error !== null) {
        const e = error as { code?: unknown; data?: { status?: unknown } };
        return {
            code: typeof e.code === "string" ? e.code : undefined,
            status: typeof e.data?.status === "number" ? e.data.status : undefined,
        };
    }
    return {};
}

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
