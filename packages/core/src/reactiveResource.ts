import type {
    ISession,
    IResourceSession,
    SessionEvents,
    ITelemetry,
    IToolConfig,
    IElicitation,
    DefaultMetricDefinitions,
    IMetrics,
} from "@mongodb-js/mcp-types";
import type { ReadResourceCallback, ResourceMetadata } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LogId } from "./logId.js";

export type ResourceConfiguration = {
    name: string;
    uri: string;
    config: ResourceMetadata;
};

export type ReactiveResourceOptions<Value, RelevantEvents extends readonly (keyof SessionEvents)[]> = {
    initial: Value;
    events: RelevantEvents;
};

/**
 * Parameters passed to the constructor of all resources that extends `ReactiveResource`.
 *
 * The MongoDB MCP Server automatically injects these parameters when
 * constructing resources and registering to the MCP Server.
 *
 * See `Server.registerResources` method in `src/server.ts` for further reference.
 */
export type ResourceConstructorParams<
    TSession extends ISession = ISession,
    TMetricsDefinitions extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> = {
    /**
     * An instance of Session class providing access to MongoDB connections,
     * loggers, config, etc.
     */
    session: TSession;

    /**
     * The telemetry service for tracking resource usage.
     */
    telemetry: ITelemetry;

    /**
     * The elicitation service for requesting user confirmation.
     */
    elicitation: IElicitation;

    /**
     * The metrics service for tracking resource usage.
     */
    metrics: IMetrics<TMetricsDefinitions>;
};

type PayloadOf<K extends keyof SessionEvents> = SessionEvents[K][0];

export interface IResourceServer {
    mcpServer: {
        registerResource: (name: string, uri: string, config: ResourceMetadata, callback: ReadResourceCallback) => void;
    };
    sendResourceListChanged(): void;
    sendResourceUpdated(uri: string): void;
}

/**
 * Abstract base class for implementing reactive MCP resources.
 *
 * Reactive resources automatically update when session events occur. They listen
 * to specified session events and can update their internal state in response.
 *
 * ## Creating a Custom Resource
 *
 * To create a custom reactive resource, extend this class and implement:
 * - `reduce()` - Update state based on session events
 * - `toOutput()` - Convert current state to resource output
 *
 * The session type parameter allows resources to access config and other session-specific
 * data through the session object.
 *
 * @example Basic Custom Resource
 * ```typescript
 * class MyResource extends ReactiveResource<string, readonly ["connect", "disconnect"]> {
 *   constructor(params: ResourceConstructorParams) {
 *     super({
 *       resourceConfiguration: {
 *         name: "my-resource",
 *         uri: "resource://my-resource",
 *         config: { description: "My reactive resource" },
 *       },
 *       options: {
 *         initial: "disconnected",
 *         events: ["connect", "disconnect"],
 *       },
 *       ...params,
 *     });
 *   }
 *
 *   reduce(eventName: "connect" | "disconnect"): string {
 *     return eventName === "connect" ? "connected" : "disconnected";
 *   }
 *
 *   toOutput(): string {
 *     return this.current;
 *   }
 * }
 * ```
 *
 * @example Resource with Config Access
 * ```typescript
 * class ConfigResource extends ReactiveResource<MyConfig, readonly [], IResourceSession<MyConfig>> {
 *   constructor(params: ResourceConstructorParams<IResourceSession<MyConfig>>) {
 *     super({
 *       resourceConfiguration: { name: "config", uri: "config://config", config: { description: "Config" } },
 *       options: { initial: params.session.userConfig, events: [] },
 *       ...params,
 *     });
 *   }
 *
 *   toOutput(): string {
 *     // Access config through session
 *     return JSON.stringify(this.session.userConfig);
 *   }
 * }
 * ```
 */
export abstract class ReactiveResource<
    Value,
    RelevantEvents extends readonly (keyof SessionEvents)[],
    TSession extends ISession = ISession,
    TMetricsDefinitions extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> {
    protected server?: IResourceServer;
    protected session: TSession;
    protected telemetry: ITelemetry;
    protected elicitation: IElicitation;
    protected metrics: IMetrics<TMetricsDefinitions>;

    protected current: Value;
    protected readonly name: string;
    protected readonly uri: string;
    protected readonly resourceConfig: ResourceMetadata;
    protected readonly events: RelevantEvents;

    constructor({
        resourceConfiguration,
        options,
        session,
        telemetry,
        elicitation,
        metrics,
        current,
    }: {
        resourceConfiguration: ResourceConfiguration;
        options: ReactiveResourceOptions<Value, RelevantEvents>;
        session: TSession;
        telemetry: ITelemetry;
        elicitation: IElicitation;
        metrics: IMetrics<TMetricsDefinitions>;
        current?: Value;
    }) {
        this.session = session;
        this.telemetry = telemetry;
        this.elicitation = elicitation;
        this.metrics = metrics;

        this.name = resourceConfiguration.name;
        this.uri = resourceConfiguration.uri;
        this.resourceConfig = resourceConfiguration.config;
        this.events = options.events;
        this.current = current ?? options.initial;

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        for (const event of this.events) {
            this.session.on(event, (...args: unknown[]) => {
                this.reduceApply(event, args[0] as PayloadOf<typeof event>);
                void this.triggerUpdate();
            });
        }
    }

    public register(server: IResourceServer): void {
        this.server = server;
        this.server.mcpServer.registerResource(this.name, this.uri, this.resourceConfig, this.resourceCallback);
    }

    private resourceCallback: ReadResourceCallback = async (uri) => ({
        contents: [
            {
                text: await this.toOutput(),
                mimeType: "application/json",
                uri: uri.href,
            },
        ],
    });

    private triggerUpdate(): void {
        try {
            this.server?.sendResourceListChanged();
            this.server?.sendResourceUpdated(this.uri);
        } catch (error: unknown) {
            this.session.logger.warning({
                id: LogId.resourceUpdateFailure,
                context: "resource",
                message: `Could not send the latest resources to the client: ${error as string}`,
            });
        }
    }

    public reduceApply(eventName: RelevantEvents[number], ...event: PayloadOf<RelevantEvents[number]>[]): void {
        this.current = this.reduce(eventName, ...event);
    }

    protected abstract reduce(eventName: RelevantEvents[number], ...event: PayloadOf<RelevantEvents[number]>[]): Value;
    public abstract toOutput(): string | Promise<string>;
}
