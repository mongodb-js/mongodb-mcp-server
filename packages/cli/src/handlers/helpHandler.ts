/* eslint-disable no-console */
import type { CliHandler } from "./types.js";
import type { UserConfig } from "../config/userConfig.js";

export class HelpHandler implements CliHandler {
    shouldHandle(config: UserConfig): boolean {
        return config.help === true;
    }

    async handle(): Promise<void> {
        console.log("For usage information refer to the README.md:");
        console.log("https://github.com/mongodb-js/mongodb-mcp-server?tab=readme-ov-file#quick-start");
        process.exit(0);
    }
}

export function handleHelpRequest(): never {
    console.log("For usage information refer to the README.md:");
    console.log("https://github.com/mongodb-js/mongodb-mcp-server?tab=readme-ov-file#quick-start");
    process.exit(0);
}
