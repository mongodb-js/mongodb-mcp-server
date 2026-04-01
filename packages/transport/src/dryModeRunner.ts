import { TransportRunnerBase, type TransportRunnerConfig } from "./base.js";
import type { DefaultMetrics } from "./types.js";

export interface DryRunModeRunnerConfig<TMetrics extends DefaultMetrics = DefaultMetrics>
    extends TransportRunnerConfig<TMetrics> {
    configForDisplay: unknown;
    tools?: Array<{ name?: string }>;
    output: {
        log(message: string): void;
        error(message: string): void;
    };
}

export class DryRunModeRunner<
    TMetrics extends DefaultMetrics = DefaultMetrics,
> extends TransportRunnerBase<TMetrics> {
    private readonly output: DryRunModeRunnerConfig["output"];
    private readonly configForDisplay: unknown;
    private readonly displayTools: Array<{ name?: string }>;

    constructor(config: DryRunModeRunnerConfig<TMetrics>) {
        super(config);
        this.output = config.output;
        this.configForDisplay = config.configForDisplay;
        this.displayTools = config.tools ?? [];
    }

    async start(): Promise<void> {
        this.output.log("Configuration:");
        this.output.log(JSON.stringify(this.configForDisplay, null, 2));

        this.output.log("Enabled tools:");
        for (const tool of this.displayTools) {
            this.output.log(JSON.stringify({ name: tool.name ?? "unknown" }, null, 2));
        }
    }

    async closeTransport(): Promise<void> {
        // No-op
    }
}
