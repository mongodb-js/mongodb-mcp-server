import { InMemoryTransport } from "./inMemoryTransport.js";
import { TransportRunnerBase, type TransportRunnerConfig } from "./base.js";
import { type Server } from "../server.js";

export type DryModeTestHelpers = {
    exit(this: void, exitCode: number): never;
    logger: {
        log(this: void, message: string): void;
        error(this: void, message: string): void;
    };
};

type DryModeRunnerConfig = TransportRunnerConfig & DryModeTestHelpers;

const defaultLogger: DryModeTestHelpers["logger"] = {
    log(message) {
        console.warn(message);
    },
    error(message) {
        console.error(message);
    },
};

export class DryModeRunner extends TransportRunnerBase {
    private server: Server | undefined;
    private exitProcess: DryModeTestHelpers["exit"];
    private consoleLogger: DryModeTestHelpers["logger"];

    constructor({ exit, logger, ...transportRunnerConfig }: DryModeRunnerConfig) {
        super(transportRunnerConfig);
        this.exitProcess = exit;
        this.consoleLogger = logger;
    }

    async start(): Promise<void> {
        try {
            this.server = await this.setupServer();
            const transport = new InMemoryTransport();

            await this.server.connect(transport);
        } catch (error: unknown) {
            this.consoleLogger.error(`Fatal error running server: ${error as string}`);
            this.exitProcess(1);
        }
    }

    async closeTransport(): Promise<void> {
        await this.server?.close();
    }

    private dumpConfig(): void {
        this.consoleLogger.log("Configuration:");
        this.consoleLogger.log(JSON.stringify(this.userConfig, null, 2));
    }

    private dumpTools(): void {
        const tools = this.server?.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            category: tool.category,
        }));
        this.consoleLogger.log("Enabled tools:");
        this.consoleLogger.log(JSON.stringify(tools, null, 2));
    }

    static async assertDryMode(
        runnerConfig: TransportRunnerConfig,
        exit: DryModeTestHelpers["exit"] = (exitCode: number) => process.exit(exitCode),
        logger: DryModeTestHelpers["logger"] = defaultLogger
    ): Promise<void> | never {
        if (runnerConfig.userConfig.dry) {
            const runner = new this({ ...runnerConfig, exit, logger });
            await runner.start();
            runner.dumpConfig();
            runner.dumpTools();
            exit(0);
        }
    }
}
