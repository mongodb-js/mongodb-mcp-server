/* eslint-disable no-console */
import type { CliHandler } from "./types.js";
import type { UserConfig } from "../config/userConfig.js";

export class VersionHandler implements CliHandler {
    private version: string;

    constructor(version: string) {
        this.version = version;
    }

    shouldHandle(config: UserConfig): boolean {
        return config.version === true;
    }

    async handle(): Promise<void> {
        console.log(this.version);
        process.exit(0);
    }
}

export function handleVersionRequest(version: string): never {
    console.log(version);
    process.exit(0);
}
