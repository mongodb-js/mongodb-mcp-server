#!/usr/bin/env node
/* eslint-disable no-console */

function enableFipsIfRequested(): void {
    let fipsError: Error | undefined;
    const tlsFIPSMode = process.argv.includes("--tlsFIPSMode");

    if (tlsFIPSMode) {
        try {
            // eslint-disable-next-line
            require("crypto").setFips(1);
        } catch (err: unknown) {
            fipsError ??= err as Error;
        }
    }

    if (tlsFIPSMode) {
        if (!fipsError && !crypto.getFips()) {
            fipsError = new Error("FIPS mode not enabled despite requested due to unknown error.");
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

enableFipsIfRequested();

import crypto from "crypto";
import { ConsoleLogger } from "@mongodb-js/mcp-logging";
import { LogId, Keychain, Elicitation } from "@mongodb-js/mcp-core";
import { runMcpCli, createServerFromUserConfig, type Handler, type UserConfig } from "@mongodb-js/mcp-cli";
import { Server } from "./server.js";
import { Session } from "./common/session.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { connectionErrorHandler } from "@mongodb-js/mcp-tools-mongodb";
import { MCPConnectionManager, ExportsManager } from "@mongodb-js/mcp-tools-mongodb";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { Keychain as CoreKeychain } from "@mongodb-js/mcp-core";
import { AtlasTelemetry, buildMachineMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import { runSetup } from "./setup/setupMcpServer.js";
import { packageInfo } from "./common/packageInfo.js";

const setupHandler: Handler = {
    shouldHandle(_config: UserConfig, args: string[]): boolean {
        return args[0] === "setup";
    },
    async handle(config: UserConfig, consoleLogger, onExit): Promise<void> {
        await runSetup(config);
        onExit(0);
    },
};

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    const { config, logger, metrics } = await createServerFromUserConfig({ args, consoleLogger: console });

    new Server
    await runMcpCli({
        args,
        consoleLogger: console,
        onExit: (code) => process.exit(code),
        clientInfo: {
            name: packageInfo.mcpServerName,
            version: packageInfo.version,
        },
        handlers: [setupHandler],
        server,
        config,
        logger,
        metrics,
    });
}

main().catch((error: unknown) => {
    const logger = new ConsoleLogger({ keychain: Keychain.root });
    logger.emergency({
        id: LogId.serverStartFailure,
        context: "server",
        message: `Fatal error running server: ${error as string}`,
    });
    process.exit(1);
});
