import type { UserConfig } from "../config/userConfig.js";

export interface CliHandler {
    shouldHandle(config: UserConfig, args: string[]): boolean;
    handle(config: UserConfig): Promise<void>;
}

export type HandlerResult = {
    shouldExit: boolean;
    exitCode?: number;
};
