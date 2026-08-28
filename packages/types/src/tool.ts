import type { CallToolResult, RequestMeta, ServerContext } from "@modelcontextprotocol/server";

export type { CallToolResult };
import type { IToolConfig } from "./config.js";
import type { ElicitationInputResponses, IElicitation } from "./elicitation.js";
import type { ICompositeLogger } from "./logging.js";
import type { IKeychain } from "./keychain.js";
import type { DefaultMetricDefinitions, IMetrics } from "./metrics.js";
import type { IUIRegistry } from "./ui.js";
import type { ITelemetry } from "./telemetry.js";

/**
 * The services every tool receives at construction, injected individually
 * (no server-scoped "session" object exists). The server is deliberately
 * stateless: MongoDB connection state lives in the app-level registry and is
 * addressed per request by `connectionId`, and per-client identity travels on
 * the tool request (see `ToolExecutionContext.request.clientInfo`).
 *
 * Tool categories extend this type with the specific app-level services they
 * need (e.g. the connection registry); `TConfig` narrows the configuration
 * subset a category reads.
 */
export type ToolServices<TConfig extends IToolConfig = IToolConfig> = {
    /** Configuration for the server */
    readonly config: TConfig;
    /** Logger for the server */
    readonly logger: ICompositeLogger;
    /** Secrets registered for redaction (used by ToolBase error handling). */
    readonly keychain: IKeychain;
};

/**
 * The service surface a tool reads from its server. Tool constructors receive
 * exactly one argument — the server — which carries the individually-injected
 * services ({@link ToolServices}) plus the shared infrastructure every tool
 * needs (telemetry, elicitation, metrics and the UI registry). Category
 * services (e.g. the connection registry) travel in `TServices`, so a server
 * is structurally assignable to the `ToolServer` of each tool category it
 * hosts.
 */
export type ToolServer<
    TServices extends ToolServices = ToolServices,
    TMetricsDefinitions extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> = TServices & {
    /** Telemetry for tracking tool usage. */
    readonly telemetry: ITelemetry;
    /** Elicitation for requesting user confirmation / input. */
    readonly elicitation: IElicitation;
    /** Metrics for tracking tool execution. */
    readonly metrics: IMetrics<TMetricsDefinitions>;
    /** UI registry for tools that embed interactive widget content. */
    readonly uiRegistry?: IUIRegistry;
};

/**
 * The type of operation the tool performs. This is used when evaluating if a tool is allowed to run based on
 * the config's `disabledTools` and `readOnly` settings.
 * - `metadata` is used for tools that read but do not access potentially user-generated
 *   data, such as listing databases, collections, or indexes, or inferring collection schema.
 * - `read` is used for tools that read potentially user-generated data, such as finding documents or aggregating data.
 *   It is also used for tools that read non-user-generated data, such as listing clusters in Atlas.
 * - `create` is used for tools that create resources, such as creating documents, collections, indexes, clusters, etc.
 * - `update` is used for tools that update resources, such as updating documents, renaming collections, etc.
 * - `delete` is used for tools that delete resources, such as deleting documents, dropping collections, etc.
 * - `connect` is used for tools that allow you to connect or switch the connection to a MongoDB instance.
 */
export type OperationType = "metadata" | "read" | "create" | "delete" | "update" | "connect";

/**
 * The category of the tool. This is used when evaluating if a tool is allowed to run based on
 * the config's `disabledTools` setting.
 * - `mongodb` is used for tools that interact with a MongoDB instance, such as finding documents,
 *   aggregating data, listing databases/collections/indexes, creating indexes, etc.
 * - `atlas` is used for tools that interact with MongoDB Atlas, such as listing clusters, creating clusters, etc.
 * - `atlas-local` is used for tools that interact with local Atlas deployments.
 * - `assistant` is used for tools that interact with the Assistant, such as searching the public knowledge base.
 * - `custom` is used for tools that are not part of the default tool categories.
 */
export type ToolCategory = "mongodb" | "atlas" | "atlas-local" | "assistant" | "custom";

/**
 * The request object passed to tool implementations: everything derived from
 * the individual request being handled. It is built fresh for each tool call
 * and deliberately lives nowhere else — the server holds no per-client or
 * per-request state, so the effective (possibly request-overridden) config
 * and the raw SDK request context travel with the call. Tools read it as
 * `request.config` / `request.raw` (see `ToolExecutionContext.request`).
 */
export type ToolRequest<TConfig extends IToolConfig = IToolConfig> = {
    /**
     * The effective configuration for this request — the base server config
     * merged with any request-level overrides (e.g. HTTP header/query
     * overrides applied per request). Request-scoped: derived fresh for each
     * call, never stored on the server. See `raw` for the original request
     * this was built around.
     */
    readonly config: TConfig;
    /**
     * The original request this request object was built around: the SDK's
     * per-request `mcpReq` object the tool call handler received. Undefined
     * when the tool is invoked directly in unit tests without a real SDK
     * request. Prefer the normalized fields (`config`, `headers`, `id`,
     * `clientInfo`, ...); reach for `raw` only when the typed surface does
     * not cover what you need.
     */
    readonly raw?: ServerContext["mcpReq"];
    /** AbortSignal for cancellation support */
    signal: AbortSignal;
    /**
     * HTTP request headers, available only when running atop
     * StreamableHttpTransport. Used for request correlation (e.g.
     * `x-request-id`) and forwarded to outgoing Atlas API requests.
     */
    headers?: Record<string, unknown>;
    /** Metadata from the original MCP request (e.g. the client's progress token). */
    _meta?: RequestMeta;
    /** The request id, when invoked through an MCP server. */
    id?: string | number;
    /** Send an MCP server notification. */
    sendNotification?: (notification: unknown) => Promise<void>;
    /**
     * Responses to a previous `input_required` round (protocol revision
     * 2026-07-28 multi-round-trip requests). Present only when this request
     * is a client retry carrying the answers to elicitation/sampling/roots
     * requests the handler returned as `inputRequired(...)`. Keyed by the
     * server-assigned identifiers of the embedded requests. Values are
     * untrusted client input.
     */
    inputResponses?: ElicitationInputResponses;
    /**
     * Total time spent waiting for the user to answer elicitation requests
     * raised while handling this call. Accumulated by
     * `ToolBase.requestConfirmation` and subtracted from the tool execution
     * duration metric, so that the user's think-time is not reported as
     * time the tool spent working.
     */
    elicitationDurationMs?: number;
    /**
     * Identity of the MCP client that issued this request, as negotiated
     * during initialization (or as declared on the request envelope in the
     * 2026-07-28 protocol). Carried on the request — it is deliberately not
     * stored on any server-scoped object, so the server holds no per-client
     * state.
     */
    clientInfo?: { name?: string; version?: string; title?: string };
};

/**
 * Request-scoped context provided during tool execution. The request object
 * ({@link ToolRequest}) holds everything derived from the individual request
 * — the effective `config`, the original `raw` request, signal, request id,
 * client identity, elicitation state — and is built fresh per call by
 * `toToolExecutionContext`. Tools receive it as the `request` argument.
 */
export type ToolExecutionContext<TConfig extends IToolConfig = IToolConfig> = {
    /** The request object this execution is built around. */
    request: ToolRequest<TConfig>;
};

export type ToolClass<TParams extends unknown[] = unknown[]> = {
    new (params: TParams): {
        name: string;
        category: ToolCategory;
        operationType: OperationType;
    };
    toolName: string;
    category: ToolCategory;
    operationType: OperationType;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolClass = ToolClass<any>;

export interface IToolRegistrar {
    register(tool: ToolClass): boolean;
}
