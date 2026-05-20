import type { CliHandler, CliHandlerContext } from "../cliHandler.js";
import { DryRunModeRunner } from "../transports/dryModeRunner.js";
import { createServicesFromUserConfig } from "../createServices.js";
import type { ToolRegistry, ResourceRegistry } from "../server.js";

export type DryRunHandlerOptions = {
    tools: ToolRegistry;
    resources: ResourceRegistry;
};

/**
 * Handler for --dryRun mode. Dumps the effective configuration and enabled
 * tools to stdout, then exits without starting the server.
 *
 * Creates its own minimal server to list the tools that would be available.
 *
 * @example
 * ```typescript
 * await runMcpCli({
 *   handlers: [new DryRunHandler({ tools: AllTools, resources: Resources })],
 *   ...
 * });
 * ```
 */
export class DryRunHandler implements CliHandler {
    private tools: ToolRegistry;
    private resources: ResourceRegistry;

    constructor({ tools, resources }: DryRunHandlerOptions) {
        this.tools = tools;
        this.resources = resources;
    }

    async handle({ config, consoleLogger, onExit, serverMetadata }: CliHandlerContext): Promise<boolean> {
        if (!config.dryRun) {
            return false;
        }

        try {
            // Create a minimal server just for listing tools
            const { server } = await createServicesFromUserConfig({
                config,
                serverMetadata,
                tools: this.tools,
                resources: this.resources,
            });

            const runner = new DryRunModeRunner({
                logger: consoleLogger,
                userConfig: config,
                server,
            });
            await runner.start();
            onExit(0);
            return true;
        } catch (error) {
            consoleLogger.error(`Fatal error running server in dry run mode: ${error as string}`);
            onExit(1);
            return true;
        }
    }
}
