import type {
    ResourceServices,
    ITelemetry,
    ReactiveResourceOptions,
    ResourceConfiguration,
    IResourceServer,
} from "@mongodb-js/mcp-types";
import type { ReadResourceCallback, ResourceMetadata } from "@modelcontextprotocol/server";
import {} from "./logId.js";

/**
 * Abstract base class for implementing MCP resources.
 *
 * Resources are constructed by the host server with `(services, telemetry)`
 * (see the CLI's `registerResources`), which the base class receives as
 * constructor options. The resolved user configuration is read from
 * `services.config`.
 *
 * @example Basic Custom Resource
 * ```typescript
 * class MyResource extends ReactiveResource<string> {
 *   constructor(services: ResourceServices, telemetry: ITelemetry) {
 *     super({
 *       resourceConfiguration: {
 *         name: "my-resource",
 *         uri: "resource://my-resource",
 *         config: { description: "My resource" },
 *       },
 *       options: {
 *         initial: "disconnected",
 *       },
 *       services,
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
    TServices extends ResourceServices = ResourceServices,
    TServer extends IResourceServer = IResourceServer,
> {
    protected server?: TServer;
    /** The individually-injected services, stored as discrete fields (no server-scoped session object). */
    protected readonly config: TServices["config"];
    protected readonly logger: TServices["logger"];
    protected readonly keychain: TServices["keychain"];
    protected telemetry: ITelemetry;

    protected current: Value;
    protected readonly name: string;
    protected readonly uri: string;
    protected readonly resourceConfig: ResourceMetadata;

    constructor({
        resourceConfiguration,
        options,
        services,
        telemetry,
        current,
    }: {
        resourceConfiguration: ResourceConfiguration;
        options: ReactiveResourceOptions<Value>;
        services: TServices;
        telemetry: ITelemetry;
        current?: Value;
    }) {
        this.config = services.config;
        this.logger = services.logger;
        this.keychain = services.keychain;
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
