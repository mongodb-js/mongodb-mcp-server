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
import { runMcpCli } from "@mongodb-js/mcp-cli";
import { DryRunHandler, HelpHandler, VersionHandler } from "@mongodb-js/mcp-cli";
import { SetupCliHandler } from "@mongodb-js/mcp-setup";
import { packageInfo } from "./common/packageInfo.js";
import { Resources } from "@mongodb-js/mcp-cli";
import { AllTools } from "./allTools.js";

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    try {
        await runMcpCli({
            args,
            serverMetadata: packageInfo,
            consoleLogger: console,
            onExit: (code: number) => process.exit(code),
            tools: AllTools,
            resources: Resources,
            handlers: [
                new HelpHandler(),
                new VersionHandler(),
                new SetupCliHandler(),
                new DryRunHandler({ tools: AllTools, resources: Resources }),
            ],
        });
    } catch (error) {
        console.error(`Fatal error running server: ${error as string}`);
        process.exit(1);
    }
}

void main();
