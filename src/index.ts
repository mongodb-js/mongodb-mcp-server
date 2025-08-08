#!/usr/bin/env node

let fipsError: Error | undefined;
function enableFipsIfRequested(): void {
    if (process.argv.includes("--tlsFIPSMode")) {
        // FIPS mode should be enabled before we run any other code, including any dependencies.
        // We still wrap this into a function so we can also call it immediately after
        // entering the snapshot main function.
        try {
            // eslint-disable-next-line
            require("crypto").setFips(1);
        } catch (err: unknown) {
            fipsError ??= err as Error;
        }
    }
}

enableFipsIfRequested();

import { ConsoleLogger, LogId } from "./common/logger.js";
import { config } from "./common/config.js";
import crypto from "crypto";
import { packageInfo } from "./common/packageInfo.js";
import { StdioRunner } from "./transports/stdio.js";
import { StreamableHttpRunner } from "./transports/streamableHttp.js";
import { systemCA } from "@mongodb-js/devtools-proxy-support";

async function main(): Promise<void> {
    systemCA().catch(() => undefined); // load system CA asynchronously as in mongosh

    assertFIPSMode();
    assertHelpMode();
    assertVersionMode();

    const transportRunner = config.transport === "stdio" ? new StdioRunner(config) : new StreamableHttpRunner(config);

    const shutdown = (): void => {
        transportRunner.logger.info({
            id: LogId.serverCloseRequested,
            context: "server",
            message: `Server close requested`,
        });

        transportRunner
            .close()
            .then(() => {
                transportRunner.logger.info({
                    id: LogId.serverClosed,
                    context: "server",
                    message: `Server closed`,
                });
                process.exit(0);
            })
            .catch((error: unknown) => {
                transportRunner.logger.error({
                    id: LogId.serverCloseFailure,
                    context: "server",
                    message: `Error closing server: ${error as string}`,
                });
                process.exit(1);
            });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGABRT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("SIGQUIT", shutdown);

    try {
        await transportRunner.start();
    } catch (error: unknown) {
        transportRunner.logger.info({
            id: LogId.serverCloseRequested,
            context: "server",
            message: "Closing server",
        });
        try {
            await transportRunner.close();
            transportRunner.logger.info({
                id: LogId.serverClosed,
                context: "server",
                message: "Server closed",
            });
        } catch (error: unknown) {
            transportRunner.logger.error({
                id: LogId.serverCloseFailure,
                context: "server",
                message: `Error closing server: ${error as string}`,
            });
        }
        throw error;
    }
}

main().catch((error: unknown) => {
    // At this point, we may be in a very broken state, so we can't rely on the logger
    // being functional. Instead, create a brand new ConsoleLogger and log the error
    // to the console.
    const logger = new ConsoleLogger();
    logger.emergency({
        id: LogId.serverStartFailure,
        context: "server",
        message: `Fatal error running server: ${error as string}`,
    });
    process.exit(1);
});

function assertFIPSMode(): void | never {
    if (config.tlsFIPSMode) {
        if (!fipsError && !crypto.getFips()) {
            fipsError = new Error("FIPS mode not enabled despite requested.");
        }
    }

    if (fipsError) {
        if (process.config.variables.node_shared_openssl) {
            console.error(
                "Could not enable FIPS mode. Please ensure that your system OpenSSL installation supports FIPS."
            );
        } else {
            console.error("Could not enable FIPS mode. This installation does not appear to support FIPS.");
        }
        console.error("Error details:");
        console.error(fipsError);
        process.exit(1);
    }
}

function assertHelpMode(): void | never {
    if (config.help) {
        console.log("For usage information refer to the README.md:");
        console.log("https://github.com/mongodb-js/mongodb-mcp-server?tab=readme-ov-file#quick-start");
        process.exit(0);
    }
}

function assertVersionMode(): void | never {
    if (config.version) {
        console.log(packageInfo.version);
        process.exit(0);
    }
}
