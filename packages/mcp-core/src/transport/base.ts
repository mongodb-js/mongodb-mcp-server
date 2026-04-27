import type { LoggerBase } from "../logging/index.js";
import { CompositeLogger } from "../logging/index.js";
import { DeviceId } from "../helpers/deviceId.js";
import { Keychain } from "../keychain.js";
import type { Metrics, DefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { Server, ServerOptions, ServerConfig } from "../server.js";
import type { SessionOptions } from "../session.js";
import type { TransportRequestContext, ITransportRunner } from "@mongodb-js/mcp-api";
import { NoopMetrics } from "../metrics/noopMetrics.js";

export type { TransportRequestContext };

/** @deprecated Use TransportRequestContext instead */
export type RequestContext = TransportRequestContext;

/**
 * A function to dynamically generate a per-session config object.
 *
 * The function is passed a context object containing:
 * 1. `userConfig`: The base config that the server was started with
 * 2. `request`: An optional `TransportRequestContext` (only available over HTTP transports)
 */
export type CreateSessionConfigFn<TConfig extends ServerConfig = ServerConfig> = (context: {
    userConfig: TConfig;
    request?: TransportRequestContext;
}) => Promise<TConfig> | TConfig;

/**
 * Configuration options for transport runners.
 */
export type TransportRunnerConfig<
    TConfig extends ServerConfig = ServerConfig,
    TMetrics extends DefaultMetrics = DefaultMetrics,
> = {
    /** Base configuration for the server. */
    userConfig: TConfig;

    /**
     * Optional list of additional loggers to attach in addition to whatever
     * the runner sets up internally. Useful for embedding hosts that want to
     * forward MCP server logs into their own logging stack.
     */
    additionalLoggers?: LoggerBase[];

    /**
     * Metrics instance to use for recording metrics. The instance must expose
     * every metric in `DefaultMetrics`.
     */
    metrics?: Metrics<TMetrics>;
};

export abstract class TransportRunnerBase<
    TConfig extends ServerConfig = ServerConfig,
    TContext = unknown,
    TMetrics extends DefaultMetrics = DefaultMetrics,
> implements ITransportRunner {
    public logger: LoggerBase;
    public metrics: Metrics<TMetrics>;

    public deviceId: DeviceId;

    /** Base configuration for the server. */
    protected readonly userConfig: TConfig;

    protected constructor({
        userConfig,
        additionalLoggers = [],
        metrics,
    }: TransportRunnerConfig<TConfig, TMetrics>) {
        this.userConfig = userConfig;
        this.metrics = metrics ?? (new NoopMetrics() as unknown as Metrics<TMetrics>);
        const loggers: LoggerBase[] = [...additionalLoggers];

        this.logger = new CompositeLogger(...loggers);
        this.deviceId = DeviceId.create(this.logger);
    }

    /**
     * Returns a new keychain root used for this runner. Subclasses can
     * override this to provide a custom keychain implementation.
     */
    protected createKeychain(): Keychain {
        return Keychain.root;
    }

    abstract start(options?: {
        /** Upstream `serverOptions` passed from running `runner.start({ serverOptions })` method */
        serverOptions?: Partial<ServerOptions<TConfig, TContext, TMetrics>>;
        /** Upstream `sessionOptions` passed from running `runner.start({ sessionOptions })` method */
        sessionOptions?: Partial<SessionOptions>;
    }): Promise<void>;

    abstract closeTransport(): Promise<void>;

    async close(): Promise<void> {
        try {
            await this.closeTransport();
        } finally {
            this.deviceId.close();
        }
    }

    protected static getInstructions(config: ServerConfig): string {
        let instructions = `
            This is the MongoDB MCP server.
        `;
        if (config.connectionString) {
            instructions += `
            This MCP server was configured with a MongoDB connection string, and you can assume that you are connected to a MongoDB cluster.
            `;
        }

        if (config.apiClientId && config.apiClientSecret) {
            instructions += `
            This MCP server was configured with MongoDB Atlas API credentials.`;
        }

        return instructions;
    }
}

// Re-export Server for convenience for transport implementers.
export type { Server };
