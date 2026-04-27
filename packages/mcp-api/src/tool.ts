import type { z, ZodRawShape } from "zod";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type ToolArgs<T extends ZodRawShape> = {
    [K in keyof T]: z.infer<T[K]>;
};

export interface ToolExecutionContext {
    signal: AbortSignal;
    /**
     * Request context object available only when running atop
     * StreamableHttpTransport.
     */
    requestInfo?: {
        headers?: Record<string, unknown>;
    };
}

export type ToolResult<OutputSchema extends ZodRawShape | undefined = undefined> = OutputSchema extends ZodRawShape
    ? StructuredToolResult<OutputSchema>
    : { content: { type: "text"; text: string }[]; isError?: boolean };

type StructuredToolResult<OutputSchema extends ZodRawShape> = {
    content: { type: "text"; text: string }[];
    isError?: boolean;
    structuredContent: z.infer<z.ZodObject<OutputSchema>>;
};

/**
 * The type of operation the tool performs. This is used when evaluating if a
 * tool is allowed to run based on the config's `disabledTools` and `readOnly`
 * settings.
 */
export type OperationType = "metadata" | "read" | "create" | "delete" | "update" | "connect";

/**
 * The category of the tool. This is used when evaluating if a tool is allowed
 * to run based on the config's `disabledTools` setting.
 */
export type ToolCategory = "mongodb" | "atlas" | "atlas-local" | "assistant";

/**
 * Parameters passed to the constructor of all tools that extends `ToolBase`.
 *
 * The MongoDB MCP Server automatically injects these parameters when
 * constructing tools and registering to the MCP Server.
 *
 * `TConfig` is the user-config type the tool's owning server is parameterised
 * over. `TContext` is the optional, library-consumer-supplied tool context.
 * `TMetrics` is the metrics instance type. The other dependencies are passed
 * through as `unknown`-ish at this layer to keep `mcp-api` implementation
 * agnostic; concrete implementations narrow these in their packages.
 */
export type ToolConstructorParams<TConfig = unknown, TContext = unknown, TMetrics = unknown> = {
    /** The unique name of this tool. */
    name: string;
    /** The category that the tool belongs to. */
    category: ToolCategory;
    /** The type of operation the tool performs. */
    operationType: OperationType;
    /** An instance of `ISession` providing access to MongoDB connections, loggers, etc. */
    session: unknown;
    /** The configuration object that MCP session was started with. */
    config: TConfig;
    /** The telemetry service for tracking tool usage. */
    telemetry: unknown;
    /** The elicitation service for requesting user confirmation. */
    elicitation: unknown;
    /** The metrics service. */
    metrics: TMetrics;
    /** Optional UI registry for rendering tool UIs. */
    uiRegistry?: unknown;
    /** Optional custom context object that will be available to tools. */
    context?: TContext;
};

/**
 * Interface form of the `ToolBase` abstract class. Tools are instances of
 * this interface and must extend the abstract base class shipped in
 * `@mongodb-js/mcp-core`.
 */
export interface IToolBase<TConfig = unknown, TContext = unknown, TMetrics = unknown> {
    readonly name: string;
    readonly category: ToolCategory;
    readonly operationType: OperationType;

    /** Human-readable description of what the tool does. */
    description: string;

    /** Zod schema defining the tool's arguments. */
    argsShape: ZodRawShape;

    /** Optional Zod schema defining the tool's structured output. */
    outputSchema?: ZodRawShape;

    /** Computed annotations exposed to the MCP server. */
    readonly annotations: ToolAnnotations;

    /**
     * Invokes the tool with the supplied arguments. Used internally by the
     * server but may also be called directly.
     */
    invoke(args: ToolArgs<ZodRawShape>, context: ToolExecutionContext): Promise<CallToolResult>;

    /** Whether the tool requires explicit user confirmation before executing. */
    requiresConfirmation(): boolean;

    /**
     * Returns whether the user (or implicit configuration) has confirmed
     * execution of this tool.
     */
    verifyConfirmed(args: ToolArgs<ZodRawShape>): Promise<boolean>;

    /** Registers the tool against the supplied server instance. */
    register(server: unknown): boolean;

    /** Whether the tool is currently registered and enabled. */
    isEnabled(): boolean;

    /** Disables a previously registered tool. */
    disable(): void;

    /** Re-enables a previously registered tool. */
    enable(): void;

    // Markers retained so that `IToolBase` is generic at the type level even
    // though no public method consumes the type parameters directly.
    readonly __toolConfigMarker?: TConfig;
    readonly __toolContextMarker?: TContext;
    readonly __toolMetricsMarker?: TMetrics;
}

/**
 * The type that all tool classes must conform to when implementing custom
 * tools for the MongoDB MCP Server.
 *
 * Tool classes expose static `toolName`, `category`, and `operationType`
 * properties and a constructor accepting `ToolConstructorParams`.
 */
export type ToolClass<TConfig = unknown, TContext = unknown, TMetrics = unknown> = {
    /** Constructor signature for the tool class. */
    new (params: ToolConstructorParams<TConfig, TContext, TMetrics>): IToolBase<TConfig, TContext, TMetrics>;

    /** The unique name of this tool. Must be unique across all tools. */
    toolName: string;

    /** The category that the tool belongs to. */
    category: ToolCategory;

    /** The type of operation the tool performs. */
    operationType: OperationType;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolClass = ToolClass<any, any, any>;

/**
 * Service responsible for registering tool classes with an MCP server.
 *
 * Concrete implementations live in `@mongodb-js/mcp-core`.
 */
export interface IToolRegistrar<TConfig = unknown, TContext = unknown, TMetrics = unknown> {
    /**
     * Registers every tool class supplied during construction. Each tool is
     * instantiated and wired up to the underlying MCP server.
     */
    registerTools(): void;

    /** Returns the list of currently registered tool instances. */
    readonly tools: ReadonlyArray<IToolBase<TConfig, TContext, TMetrics>>;
}
