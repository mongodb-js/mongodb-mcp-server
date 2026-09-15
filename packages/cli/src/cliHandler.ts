import type { ServerMetadata } from "@mongodb-js/mcp-types";
import type { Keychain } from "@mongodb-js/mcp-core";
import type { UserConfig } from "./config/userConfig.js";
import type { OnExit, Console } from "./types.js";

export type CliHandlerContext = {
    config: UserConfig;
    args: string[];
    consoleLogger: Console;
    onExit: OnExit;
    serverMetadata: ServerMetadata;
    /** The server's immutable redaction keychain, built from config secrets. */
    keychain: Keychain;
};

export type CliHandler = {
    handle(context: CliHandlerContext): Promise<boolean>;
};
