import type {
    IResourceSession,
    SessionEvents,
    ITelemetry,
    ReactiveResourceOptions,
    ResourceConfiguration,
    IResourceServer,
} from "@mongodb-js/mcp-types";
import type { ReadResourceCallback, ResourceMetadata } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LogId } from "./logId.js";

type PayloadOf<K extends keyof SessionEvents> = SessionEvents[K][0];

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
 * Resources are constructed by the host server with `(session, config, telemetry)`
 * (see the CLI's `registerResources`), which the base class receives as separate
 * constructor options. The `config` is the server's resolved user configuration.
 *
 * @example Basic Custom Resource
 * ```typescript
 * class MyResource extends ReactiveResource<string, readonly ["connect", "disconnect"]> {
 *   constructor(session: IResourceSession, config: UserConfig, telemetry: ITelemetry) {
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
 *       session,
 *       config,
 *       telemetry,
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
 */
export abstract class ReactiveResource<
    /** Value stored in the resource */
    Value,
    RelevantEvents extends readonly (keyof SessionEvents)[],
    TSession extends IResourceSession = IResourceSession,
    TConfig extends IResourceSession["config"] = IResourceSession["config"],
> {
    protected server?: IResourceServer;
    protected session: TSession;
    /** The resolved user configuration, supplied by the host server at construction. */
    protected config: TConfig;
    protected telemetry: ITelemetry;

    protected current: Value;
    protected readonly name: string;
    protected readonly uri: string;
    protected readonly resourceConfig: ResourceMetadata;
    protected readonly events: RelevantEvents;

    constructor({
        resourceConfiguration,
        options,
        session,
        config,
        telemetry,
        current,
    }: {
        resourceConfiguration: ResourceConfiguration;
        options: ReactiveResourceOptions<Value, RelevantEvents>;
        session: TSession;
        config: TConfig;
        telemetry: ITelemetry;
        current?: Value;
    }) {
        this.session = session;
        this.config = config;
        this.telemetry = telemetry;

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
                this.reduceApply(event, ...args);
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
