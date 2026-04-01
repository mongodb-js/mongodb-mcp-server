import { InMemoryTransport } from "./inMemoryTransport.js";
import { type CustomizableSessionOptions, TransportRunnerBase, type TransportRunnerConfig } from "./base.js";
import { type Server } from "../server.js";
import type { CustomizableServerOptions } from "../lib.js";

export type DryRunModeTestHelpers = {
    output: {
        log(this: void, message: string): void;
        error(this: void, message: string): void;
    };
};

type DryRunModeRunnerConfig = TransportRunnerConfig & DryRunModeTestHelpers;

export class DryRunModeRunner extends TransportRunnerBase {
    private server: Server | undefined;
    private output: DryRunModeTestHelpers["output"];

    constructor({ output, ...transportRunnerConfig }: DryRunModeRunnerConfig) {
        super(transportRunnerConfig);
        this.output = output;
    }

    override async start({
        serverOptions,
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions;
        sessionOptions?: CustomizableSessionOptions;
    } = {}): Promise<void> {
        this.server = await this.createServer({ serverOptions, sessionOptions });
        const transport = new InMemoryTransport();

        await this.server.connect(transport);
        this.dumpConfig();
        this.dumpTools();
    }

    override async closeTransport(): Promise<void> {
        await this.server?.close();
    }

    private dumpConfig(): void {
        this.output.log("Configuration:");
        this.output.log(JSON.stringify(this.userConfig, null, 2));
    }

    private dumpTools(): void {
        const tools =
            this.server?.tools
                .filter((tool) => tool.isEnabled())
                .map((tool) => ({
                    name: tool.name,
                    category: tool.category,
                })) ?? [];
        this.output.log("Enabled tools:");
        this.output.log(JSON.stringify(tools, null, 2));
    }
}
