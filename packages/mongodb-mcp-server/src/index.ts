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
import {
    runMcpCli,
    createServerFromUserConfig,
    DryRunHandler,
    type Handler,
    type UserConfig,
} from "@mongodb-js/mcp-cli";
import { runSetup } from "./setup/setupMcpServer.js";
import { packageInfo } from "./common/packageInfo.js";
import { Resources } from "./resources/resources.js";
import { AllTools } from "./tools/index.js";

const setupHandler: Handler = {
    shouldHandle(_config: UserConfig, args: string[]): boolean {
        return args[0] === "setup";
    },
    async handle(
        config: UserConfig,
        _consoleLogger: { error: (msg: string) => void },
        onExit: (code: number) => void
    ): Promise<void> {
        await runSetup(config);
        onExit(0);
    },
};

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    // Get server from CLI factory
    const { server, config, logger, metrics } = await createServerFromUserConfig({
        args,
        consoleLogger: console,
        packageInfo,
        tools: AllTools,
        resources: Resources,
    });

    await runMcpCli({
        args,
        consoleLogger: console,
        onExit: (code: number) => process.exit(code),
        clientInfo: {
            name: packageInfo.mcpServerName,
            version: packageInfo.version,
        },
        handlers: [setupHandler, new DryRunHandler({ server })],
        server,
        config,
        logger,
        metrics,
    });
}

main().catch((error: unknown) => {
    console.error(`Fatal error running server: ${error as string}`);
    process.exit(1);
});
