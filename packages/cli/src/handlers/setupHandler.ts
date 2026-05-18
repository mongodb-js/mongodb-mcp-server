import type { CliHandler } from "./types.js";
import type { UserConfig } from "../config/userConfig.js";

export type SetupFunction = (config: UserConfig) => Promise<void>;

export class SetupHandler implements CliHandler {
    private setupFn: SetupFunction;

    constructor(setupFn: SetupFunction) {
        this.setupFn = setupFn;
    }

    shouldHandle(_config: UserConfig, args: string[]): boolean {
        return args[0] === "setup";
    }

    async handle(config: UserConfig): Promise<void> {
        await this.setupFn(config);
        process.exit(0);
    }
}
