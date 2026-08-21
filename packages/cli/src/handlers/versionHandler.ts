import type { CliHandler, CliHandlerContext } from "../cliHandler.js";

/**
 * Handler for --version flag. Displays version information and exits.
 */
export class VersionHandler implements CliHandler {
    async handle({ config, consoleLogger, onExit, serverMetadata }: CliHandlerContext): Promise<boolean> {
        if (!config.version) {
            return false;
        }

        consoleLogger.log(serverMetadata.version);
        onExit(0);
        return Promise.resolve(true);
    }
}
