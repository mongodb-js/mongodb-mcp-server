import type {
    IResourceSession,
    ITelemetry,
    ReactiveResourceOptions,
    ResourceConfiguration,
    IResourceServer,
} from "@mongodb-js/mcp-types";
import type { ReadResourceCallback, ResourceMetadata } from "@modelcontextprotocol/server";
import { LogId } from "./logId.js";

/**
 * Abstract base class for implementing MCP resources.
 *
 * Resources are constructed by the host server with `(serverContext, telemetry)`
 * (see the CLI's `registerResources`), which the base class receives as
 * constructor options. The resolved user configuration is read from
 * `serverContext.config`.
 *
 * @example Basic Custom Resource
 * ```typescript
 * class MyResource extends ReactiveResource<string> {
 *   constructor(serverContext: IResourceSession, telemetry: ITelemetry) {
 *     super({
 *       resourceConfiguration: {
 *         name: "my-resource",
 *         uri: "resource://my-resource",
 *         config: { description: "My resource" },
 *       },
 *       options: {
 *         initial: "disconnected",
 *       },
 *       session: serverContext,
 *       telemetry,
 *     });
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
    TSession extends IResourceSession = IResourceSession,
    TServer extends IResourceServer = IResourceServer,
> {
    protected server?: TServer;
    protected session: TSession;
    protected telemetry: ITelemetry;

    protected current: Value;
    protected readonly name: string;
    protected readonly uri: string;
    protected readonly resourceConfig: ResourceMetadata;

    constructor({
        resourceConfiguration,
        options,
        session,
        telemetry,
        current,
    }: {
        resourceConfiguration: ResourceConfiguration;
        options: ReactiveResourceOptions<Value>;
        session: TSession;
        telemetry: ITelemetry;
        current?: Value;
    }) {
        this.session = session;
        this.telemetry = telemetry;

        this.name = resourceConfiguration.name;
        this.uri = resourceConfiguration.uri;
        this.resourceConfig = resourceConfiguration.config;
        this.current = current ?? options.initial;
    }

    public register(server: TServer): void {
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

    public abstract toOutput(): string | Promise<string>;
}
