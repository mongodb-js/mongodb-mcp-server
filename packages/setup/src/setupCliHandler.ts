import { runSetup } from "./setupMcpServer.js";
import type { CliHandler, CliHandlerContext } from "@mongodb-js/mcp-cli";

/**
 * CLI Handler for "setup" command. Runs the setup wizard.
 */
export class SetupCliHandler implements CliHandler {
    async handle({ args, config, onExit }: CliHandlerContext): Promise<boolean> {
        if (args[0] !== "setup") {
            return false;
        }

        await runSetup(config);
        onExit(0);
        return true;
    }
}
