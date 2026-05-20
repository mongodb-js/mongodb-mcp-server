import type { CliHandler, CliHandlerContext } from "../cliHandler.js";

/**
 * Handler for --help flag. Displays help information and exits.
 */
export class HelpHandler implements CliHandler {
    async handle({ config, consoleLogger, onExit }: CliHandlerContext): Promise<boolean> {
        if (!config.help) {
            return false;
        }

        consoleLogger.log("For usage information refer to the README.md:");
        consoleLogger.log("https://github.com/mongodb-js/mongodb-mcp-server?tab=readme-ov-file#quick-start");
        onExit(0);
        return Promise.resolve(true);
    }
}
