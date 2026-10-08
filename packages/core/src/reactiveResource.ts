import type {
    ReactiveResourceOptions,
    ResourceConfiguration,
    IResourceServer,
    TransportRequestContext,
} from "@mongodb-js/mcp-types";
import type { ReadResourceCallback, ResourceMetadata } from "@modelcontextprotocol/server";

/**
 * Abstract base class for implementing MCP resources.
 *
 * Resources are constructed by the host server with `({ server })`
 * (see the CLI's `registerResources`). The server is the composition: resources
 * read whatever they need (config, logger, keychain, telemetry, and any
 * host-specific extras such as the connection registry) off the server itself,
 * rather than copy services into discrete fields at construction.
 *
 * @example Basic Custom Resource
 * ```typescript
 * class MyResource extends ReactiveResource<string> {
 *   constructor({ server }: { server: MyServer }) {
 *     super({
 *       resourceConfiguration: {
 *         name: "my-resource",
 *         uri: "resource://my-resource",
 *         config: { description: "My resource" },
 *       },
 *       options: {
 *         initial: "disconnected",
 *       },
 *       server,
 *     });
 *   }
 *
 *   toOutput(): string {
 *     return this.server.config.logLevel;
 *   }
 * }
 * ```
 */
export abstract class ReactiveResource<
    /** Value stored in the resource */
    Value,
    TServer extends IResourceServer = IResourceServer,
> {
    /** The host server this resource registers against and reads services from. */
    protected server: TServer;

    /** The transport request that drove creation of the host server (undefined for non-HTTP). */
    protected transportRequest?: TransportRequestContext;

    protected current: Value;
    protected readonly name: string;
    protected readonly uri: string;
    protected readonly resourceConfig: ResourceMetadata;

    constructor({
        resourceConfiguration,
        options,
        server,
        transportRequest,
        current,
    }: {
        resourceConfiguration: ResourceConfiguration;
        options: ReactiveResourceOptions<Value>;
        server: TServer;
        transportRequest?: TransportRequestContext;
        current?: Value;
    }) {
        this.server = server;
        this.transportRequest = transportRequest;

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
