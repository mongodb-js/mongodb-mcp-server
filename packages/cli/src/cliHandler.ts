import type { ServerMetadata } from "@mongodb-js/mcp-types";
import type { UserConfig } from "src/config/userConfig.js";
import type { OnExit, ConsoleLogger } from "src/types.js";

export type CliHandlerContext = {
    config: UserConfig;
    args: string[];
    consoleLogger: ConsoleLogger;
    onExit: OnExit;
    serverMetadata: ServerMetadata;
};

export type CliHandler = {
    handle(context: CliHandlerContext): Promise<boolean>;
};
