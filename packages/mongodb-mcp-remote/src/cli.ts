#!/usr/bin/env node

import { createFetch, systemCA } from "@mongodb-js/devtools-proxy-support";
import type { ProxyAwareFetch } from "./common.js";
import { loadConfig, ConfigurationError } from "./config.js";
import { TokenManager, TokenError } from "./tokenManager.js";
import { Forwarder } from "./forwarder.js";
import { StdioTransport } from "./stdio.js";
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

    await systemCA().catch((error) => {
        logger.warning(`Failed to load system CA certificates: ${String(error)}`);
    });

    const fetch = createFetch({ useEnvironmentVariableProxies: true }) as unknown as ProxyAwareFetch;

    const tokenManager = new TokenManager(
        config.tokenUrl,
        config.clientId,
        config.clientSecret,
        config.tokenTimeoutMs,
        fetch
    );
    const forwarder = new Forwarder(config.remoteUrl, tokenManager, config.remoteTimeoutMs, fetch);

    try {
        await tokenManager.getToken();
    } catch (error) {
        const message = error instanceof TokenError ? error.message : String(error);
        logger.error(`Failed to acquire access token: ${message}`);
        process.exit(1);
    }

    const stdioTransport = new StdioTransport(forwarder, () => process.exit(0));

    const shutdown = (): void => {
        logger.info("Shutting down");
        stdioTransport.stop();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGABRT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("SIGQUIT", shutdown);

    stdioTransport.start();
}

main().catch((error) => {
    process.stderr.write(`Fatal error: ${String(error)}\n`);
    process.exit(1);
});
