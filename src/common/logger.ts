import fs from "fs/promises";
import type { MongoLogId, MongoLogWriter } from "mongodb-log-writer";
import { mongoLogId, MongoLogManager } from "mongodb-log-writer";
import { redact } from "mongodb-redact";
import type { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";
import { EventEmitter } from "events";
import type { Server, UserConfig } from "../lib.js";
import type { Keychain } from "./keychain.js";

export type LogLevel = LoggingMessageNotification["params"]["level"];

export type CounterMetric<TLabels extends Record<string, string>> = {
    type: "counter";
    labels: TLabels;
};

export type HistogramMetric<TLabels extends Record<string, string>> = {
    type: "histogram";
    labels: TLabels;
    value: number;
};

/**
 * Type-safe metric definitions that enforce the correct shape for each metric.
 * Each metric name has specific requirements for type, labels, and value.
 */
type MetricDefinitions = {
    /** Counter: Total number of tool executions by tool name and result (success/failure). */
    tool_executions_total: CounterMetric<{ tool: string; result: "success" | "failure" }>;
    /** Histogram: Duration of tool execution in milliseconds, labeled by tool name. */
    tool_execution_duration_ms: HistogramMetric<{ tool: string }>;
    /** Counter: Total number of MongoDB connection attempts and their results. */
    mongodb_connections_total: CounterMetric<{ result: "attempt" | "success" | "failure" }>;
};

/**
 * Carries structured, machine-readable metric metadata alongside a log event.
 * The shape is enforced based on the metric name - each metric requires specific
 * labels, type, and value based on its definition in MetricDefinitions.
 *
 * @example
 * // Correct: histogram with required value and labels
 * const metric: MetricHint = {
 *   name: "tool_execution_duration_ms",
 *   type: "histogram",
 *   labels: { tool: "find" },
 *   value: 123
 * };
 *
 * @example
 * // Correct: counter with required labels
 * const metric: MetricHint = {
 *   name: "tool_executions_total",
 *   type: "counter",
 *   labels: { tool: "find", result: "failure" }
 * };
 */
export type MetricHint = {
    [K in keyof MetricDefinitions]: {
        name: K;
    } & MetricDefinitions[K];
}[keyof MetricDefinitions];

/**
 * Alias for logs without any associated metrics.
 */
type NoMetrics = { metrics?: never };

/**
 * Single source of truth for all log definitions.
 * Each log defines its required metrics (or NoMetrics if none).
 */
type LogDefinitions = {
    serverStartFailure: NoMetrics;
    serverInitialized: NoMetrics;
    serverCloseRequested: NoMetrics;
    serverClosed: NoMetrics;
    serverCloseFailure: NoMetrics;
    serverDuplicateLoggers: NoMetrics;
    serverMcpClientSet: NoMetrics;

    atlasCheckCredentials: NoMetrics;
    atlasDeleteDatabaseUserFailure: NoMetrics;
    atlasConnectFailure: NoMetrics;
    atlasInspectFailure: NoMetrics;
    atlasConnectAttempt: NoMetrics;
    atlasConnectSucceeded: NoMetrics;
    atlasApiRevokeFailure: NoMetrics;
    atlasIpAccessListAdded: NoMetrics;
    atlasIpAccessListAddFailure: NoMetrics;
    atlasApiBaseUrlInsecure: NoMetrics;

    telemetryDisabled: NoMetrics;
    telemetryEmitFailure: NoMetrics;
    telemetryEmitStart: NoMetrics;
    telemetryEmitSuccess: NoMetrics;
    telemetryMetadataError: NoMetrics;
    deviceIdResolutionError: NoMetrics;
    deviceIdTimeout: NoMetrics;
    telemetryClose: NoMetrics;

    toolExecute: { metrics: ["tool_execution_duration_ms"] };
    toolExecuteFailure: { metrics: ["tool_executions_total"] };
    toolDisabled: NoMetrics;
    toolMetadataChange: NoMetrics;

    mongodbConnectFailure: { metrics: ["mongodb_connections_total"] };
    mongodbDisconnectFailure: NoMetrics;
    mongodbConnectTry: { metrics: ["mongodb_connections_total"] };
    mongodbCursorCloseError: NoMetrics;
    mongodbIndexCheckFailure: NoMetrics;

    toolUpdateFailure: NoMetrics;
    resourceUpdateFailure: NoMetrics;
    updateToolMetadata: NoMetrics;
    toolValidationError: NoMetrics;

    streamableHttpTransportStarted: NoMetrics;
    streamableHttpTransportSessionCloseFailure: NoMetrics;
    streamableHttpTransportSessionCloseNotification: NoMetrics;
    streamableHttpTransportSessionCloseNotificationFailure: NoMetrics;
    streamableHttpTransportRequestFailure: NoMetrics;
    streamableHttpTransportCloseFailure: NoMetrics;
    streamableHttpTransportKeepAliveFailure: NoMetrics;
    streamableHttpTransportKeepAlive: NoMetrics;
    streamableHttpTransportHttpHostWarning: NoMetrics;
    streamableHttpTransportSessionNotFound: NoMetrics;
    streamableHttpTransportDisallowedExternalSessionError: NoMetrics;

    httpServerStarted: NoMetrics;
    httpServerStopping: NoMetrics;
    httpServerStopped: NoMetrics;

    exportCleanupError: NoMetrics;
    exportCreationError: NoMetrics;
    exportCreationCleanupError: NoMetrics;
    exportReadError: NoMetrics;
    exportCloseError: NoMetrics;
    exportedDataListError: NoMetrics;
    exportedDataAutoCompleteError: NoMetrics;
    exportLockError: NoMetrics;

    oidcFlow: NoMetrics;

    atlasPaSuggestedIndexesFailure: NoMetrics;
    atlasPaDropIndexSuggestionsFailure: NoMetrics;
    atlasPaSchemaAdviceFailure: NoMetrics;
    atlasPaSlowQueryLogsFailure: NoMetrics;

    atlasLocalDockerNotRunning: NoMetrics;
    atlasLocalUnsupportedPlatform: NoMetrics;

    assistantListKnowledgeSourcesError: NoMetrics;
    assistantSearchKnowledgeError: NoMetrics;
};

/**
 * LogId constants - derived from LogDefinitions keys.
 * These are string literals used for type discrimination.
 */
export const LogId = {
    serverStartFailure: "serverStartFailure",
    serverInitialized: "serverInitialized",
    serverCloseRequested: "serverCloseRequested",
    serverClosed: "serverClosed",
    serverCloseFailure: "serverCloseFailure",
    serverDuplicateLoggers: "serverDuplicateLoggers",
    serverMcpClientSet: "serverMcpClientSet",

    atlasCheckCredentials: "atlasCheckCredentials",
    atlasDeleteDatabaseUserFailure: "atlasDeleteDatabaseUserFailure",
    atlasConnectFailure: "atlasConnectFailure",
    atlasInspectFailure: "atlasInspectFailure",
    atlasConnectAttempt: "atlasConnectAttempt",
    atlasConnectSucceeded: "atlasConnectSucceeded",
    atlasApiRevokeFailure: "atlasApiRevokeFailure",
    atlasIpAccessListAdded: "atlasIpAccessListAdded",
    atlasIpAccessListAddFailure: "atlasIpAccessListAddFailure",
    atlasApiBaseUrlInsecure: "atlasApiBaseUrlInsecure",

    telemetryDisabled: "telemetryDisabled",
    telemetryEmitFailure: "telemetryEmitFailure",
    telemetryEmitStart: "telemetryEmitStart",
    telemetryEmitSuccess: "telemetryEmitSuccess",
    telemetryMetadataError: "telemetryMetadataError",
    deviceIdResolutionError: "deviceIdResolutionError",
    deviceIdTimeout: "deviceIdTimeout",
    telemetryClose: "telemetryClose",

    toolExecute: "toolExecute",
    toolExecuteFailure: "toolExecuteFailure",
    toolDisabled: "toolDisabled",
    toolMetadataChange: "toolMetadataChange",

    mongodbConnectFailure: "mongodbConnectFailure",
    mongodbDisconnectFailure: "mongodbDisconnectFailure",
    mongodbConnectTry: "mongodbConnectTry",
    mongodbCursorCloseError: "mongodbCursorCloseError",
    mongodbIndexCheckFailure: "mongodbIndexCheckFailure",

    toolUpdateFailure: "toolUpdateFailure",
    resourceUpdateFailure: "resourceUpdateFailure",
    updateToolMetadata: "updateToolMetadata",
    toolValidationError: "toolValidationError",

    streamableHttpTransportStarted: "streamableHttpTransportStarted",
    streamableHttpTransportSessionCloseFailure: "streamableHttpTransportSessionCloseFailure",
    streamableHttpTransportSessionCloseNotification: "streamableHttpTransportSessionCloseNotification",
    streamableHttpTransportSessionCloseNotificationFailure: "streamableHttpTransportSessionCloseNotificationFailure",
    streamableHttpTransportRequestFailure: "streamableHttpTransportRequestFailure",
    streamableHttpTransportCloseFailure: "streamableHttpTransportCloseFailure",
    streamableHttpTransportKeepAliveFailure: "streamableHttpTransportKeepAliveFailure",
    streamableHttpTransportKeepAlive: "streamableHttpTransportKeepAlive",
    streamableHttpTransportHttpHostWarning: "streamableHttpTransportHttpHostWarning",
    streamableHttpTransportSessionNotFound: "streamableHttpTransportSessionNotFound",
    streamableHttpTransportDisallowedExternalSessionError: "streamableHttpTransportDisallowedExternalSessionError",

    httpServerStarted: "httpServerStarted",
    httpServerStopping: "httpServerStopping",
    httpServerStopped: "httpServerStopped",

    exportCleanupError: "exportCleanupError",
    exportCreationError: "exportCreationError",
    exportCreationCleanupError: "exportCreationCleanupError",
    exportReadError: "exportReadError",
    exportCloseError: "exportCloseError",
    exportedDataListError: "exportedDataListError",
    exportedDataAutoCompleteError: "exportedDataAutoCompleteError",
    exportLockError: "exportLockError",

    oidcFlow: "oidcFlow",

    atlasPaSuggestedIndexesFailure: "atlasPaSuggestedIndexesFailure",
    atlasPaDropIndexSuggestionsFailure: "atlasPaDropIndexSuggestionsFailure",
    atlasPaSchemaAdviceFailure: "atlasPaSchemaAdviceFailure",
    atlasPaSlowQueryLogsFailure: "atlasPaSlowQueryLogsFailure",

    atlasLocalDockerNotRunning: "atlasLocalDockerNotRunning",
    atlasLocalUnsupportedPlatform: "atlasLocalUnsupportedPlatform",

    assistantListKnowledgeSourcesError: "assistantListKnowledgeSourcesError",
    assistantSearchKnowledgeError: "assistantSearchKnowledgeError",
} as const satisfies Record<keyof LogDefinitions, string>;

/**
 * Maps LogId keys to their actual MongoLogId values.
 * Used internally by the logger to convert from string keys to MongoLogId.
 */
const MongoLogIds: Record<LogIdKey, MongoLogId> = {
    serverStartFailure: mongoLogId(1_000_001),
    serverInitialized: mongoLogId(1_000_002),
    serverCloseRequested: mongoLogId(1_000_003),
    serverClosed: mongoLogId(1_000_004),
    serverCloseFailure: mongoLogId(1_000_005),
    serverDuplicateLoggers: mongoLogId(1_000_006),
    serverMcpClientSet: mongoLogId(1_000_007),

    atlasCheckCredentials: mongoLogId(1_001_001),
    atlasDeleteDatabaseUserFailure: mongoLogId(1_001_002),
    atlasConnectFailure: mongoLogId(1_001_003),
    atlasInspectFailure: mongoLogId(1_001_004),
    atlasConnectAttempt: mongoLogId(1_001_005),
    atlasConnectSucceeded: mongoLogId(1_001_006),
    atlasApiRevokeFailure: mongoLogId(1_001_007),
    atlasIpAccessListAdded: mongoLogId(1_001_008),
    atlasIpAccessListAddFailure: mongoLogId(1_001_009),
    atlasApiBaseUrlInsecure: mongoLogId(1_001_010),

    telemetryDisabled: mongoLogId(1_002_001),
    telemetryEmitFailure: mongoLogId(1_002_002),
    telemetryEmitStart: mongoLogId(1_002_003),
    telemetryEmitSuccess: mongoLogId(1_002_004),
    telemetryMetadataError: mongoLogId(1_002_005),
    deviceIdResolutionError: mongoLogId(1_002_006),
    deviceIdTimeout: mongoLogId(1_002_007),
    telemetryClose: mongoLogId(1_002_008),

    toolExecute: mongoLogId(1_003_001),
    toolExecuteFailure: mongoLogId(1_003_002),
    toolDisabled: mongoLogId(1_003_003),
    toolMetadataChange: mongoLogId(1_003_004),

    mongodbConnectFailure: mongoLogId(1_004_001),
    mongodbDisconnectFailure: mongoLogId(1_004_002),
    mongodbConnectTry: mongoLogId(1_004_003),
    mongodbCursorCloseError: mongoLogId(1_004_004),
    mongodbIndexCheckFailure: mongoLogId(1_004_005),

    toolUpdateFailure: mongoLogId(1_005_001),
    resourceUpdateFailure: mongoLogId(1_005_002),
    updateToolMetadata: mongoLogId(1_005_003),
    toolValidationError: mongoLogId(1_005_004),

    streamableHttpTransportStarted: mongoLogId(1_006_001),
    streamableHttpTransportSessionCloseFailure: mongoLogId(1_006_002),
    streamableHttpTransportSessionCloseNotification: mongoLogId(1_006_003),
    streamableHttpTransportSessionCloseNotificationFailure: mongoLogId(1_006_004),
    streamableHttpTransportRequestFailure: mongoLogId(1_006_005),
    streamableHttpTransportCloseFailure: mongoLogId(1_006_006),
    streamableHttpTransportKeepAliveFailure: mongoLogId(1_006_007),
    streamableHttpTransportKeepAlive: mongoLogId(1_006_008),
    streamableHttpTransportHttpHostWarning: mongoLogId(1_006_009),
    streamableHttpTransportSessionNotFound: mongoLogId(1_006_010),
    streamableHttpTransportDisallowedExternalSessionError: mongoLogId(1_006_011),

    httpServerStarted: mongoLogId(1_006_100),
    httpServerStopping: mongoLogId(1_006_101),
    httpServerStopped: mongoLogId(1_006_102),

    exportCleanupError: mongoLogId(1_007_001),
    exportCreationError: mongoLogId(1_007_002),
    exportCreationCleanupError: mongoLogId(1_007_003),
    exportReadError: mongoLogId(1_007_004),
    exportCloseError: mongoLogId(1_007_005),
    exportedDataListError: mongoLogId(1_007_006),
    exportedDataAutoCompleteError: mongoLogId(1_007_007),
    exportLockError: mongoLogId(1_007_008),

    oidcFlow: mongoLogId(1_008_001),

    atlasPaSuggestedIndexesFailure: mongoLogId(1_009_001),
    atlasPaDropIndexSuggestionsFailure: mongoLogId(1_009_002),
    atlasPaSchemaAdviceFailure: mongoLogId(1_009_003),
    atlasPaSlowQueryLogsFailure: mongoLogId(1_009_004),

    atlasLocalDockerNotRunning: mongoLogId(1_010_001),
    atlasLocalUnsupportedPlatform: mongoLogId(1_010_002),

    assistantListKnowledgeSourcesError: mongoLogId(1_011_001),
    assistantSearchKnowledgeError: mongoLogId(1_011_002),
};

export type LogIdKey = keyof LogDefinitions;

/**
 * Base properties shared by all log payloads.
 */
type BaseLogPayload = {
    context: string;
    message: string;
    noRedaction?: boolean | LoggerType | LoggerType[];
    attributes?: Record<string, string>;
};

/**
 * Internal payload type used by logCore - has MongoLogId instead of string key.
 */
type InternalLogPayload = BaseLogPayload & {
    id: MongoLogId;
    metrics?: MetricHint[];
};

/**
 * Helper type to convert an array of metric names to their corresponding metric definitions.
 */
type MetricsFromNames<T extends readonly (keyof MetricDefinitions)[]> = {
    [K in keyof T]: T[K] extends keyof MetricDefinitions ? { name: T[K] } & MetricDefinitions[T[K]] : never;
};

/**
 * Log payload that enforces metric requirements based on the specific LogId key (as string).
 * This is a discriminated union where the `id` field is a string literal that maps to a LogId.
 * TypeScript can properly discriminate based on the string literal type.
 *
 * Metrics are required for logs defined with `metrics` property in LogDefinitions.
 * Metrics are optional for logs defined with NoMetrics.
 */
export type LogPayload = {
    [K in LogIdKey]: BaseLogPayload &
        (LogDefinitions[K] extends { metrics: infer M extends readonly (keyof MetricDefinitions)[] }
            ? {
                  id: K;
                  metrics: MetricsFromNames<M>;
              }
            : {
                  id: K;
                  metrics?: MetricHint[];
              });
}[LogIdKey];

export type LoggerType = "console" | "disk" | "mcp";

/**
 * The argument passed to `LoggerBase.onLogEvent`.
 */
export type LogEvent = {
    level: LogLevel;
    /** A payload with the message redacted according to this logger's configuration. */
    payload: LogPayload;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventMap<T> = Record<keyof T, any[]> | DefaultEventMap;
type DefaultEventMap = [never];

export abstract class LoggerBase<T extends EventMap<T> = DefaultEventMap> extends EventEmitter<T> {
    private readonly defaultUnredactedLogger: LoggerType = "mcp";

    constructor(private readonly keychain: Keychain | undefined) {
        super();
    }

    public log(level: LogLevel, payload: LogPayload): void {
        // If no explicit value is supplied for unredacted loggers, default to "mcp"
        const noRedaction = payload.noRedaction !== undefined ? payload.noRedaction : this.defaultUnredactedLogger;

        // Convert string id to MongoLogId
        const mongoLogId = MongoLogIds[payload.id];

        const redacted: LogPayload = {
            ...payload,
            message: this.redactIfNecessary(payload.message, noRedaction),
        };

        // Create internal payload with MongoLogId for logCore
        const internalPayload: InternalLogPayload = {
            ...redacted,
            id: mongoLogId,
        };

        this.logCore(level, internalPayload);
        this.onLogEvent({ level, payload: redacted });
    }

    protected abstract readonly type?: LoggerType;

    protected abstract logCore(level: LogLevel, payload: InternalLogPayload): void;

    /**
     * Called on every log event after `logCore`, with the already-redacted payload.
     * Override to add observability behavior such as Prometheus metrics.
     *
     * @example
     * ```ts
     * class PrometheusLogger extends LoggerBase {
     *
     *     protected override onLogEvent({ level, payload }: LogEvent): void {
     *         this.logEvents.inc({ level, context: payload.context });
     *         payload.metrics?.forEach(metric => {
     *             if (metric.type === "counter") {
     *                 this.getCounter(metric.name).inc(metric.labels);
     *             } else if (metric.type === "histogram") {
     *                 this.getHistogram(metric.name).observe(metric.labels, metric.value);
     *             }
     *         });
     *     }
     * }
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected onLogEvent(_: LogEvent): void {}

    private redactIfNecessary(message: string, noRedaction: LogPayload["noRedaction"]): string {
        if (typeof noRedaction === "boolean" && noRedaction) {
            // If the consumer has supplied noRedaction: true, we don't redact the log message
            // regardless of the logger type
            return message;
        }

        if (typeof noRedaction === "string" && noRedaction === this.type) {
            // If the consumer has supplied noRedaction: logger-type, we skip redacting if
            // our logger type is the same as what the consumer requested
            return message;
        }

        if (
            typeof noRedaction === "object" &&
            Array.isArray(noRedaction) &&
            this.type &&
            noRedaction.indexOf(this.type) !== -1
        ) {
            // If the consumer has supplied noRedaction: array, we skip redacting if our logger
            // type is included in that array
            return message;
        }

        return redact(message, this.keychain?.allSecrets ?? []);
    }

    public info(payload: LogPayload): void {
        this.log("info", payload);
    }

    public error(payload: LogPayload): void {
        this.log("error", payload);
    }

    public debug(payload: LogPayload): void {
        this.log("debug", payload);
    }

    public notice(payload: LogPayload): void {
        this.log("notice", payload);
    }

    public warning(payload: LogPayload): void {
        this.log("warning", payload);
    }

    public critical(payload: LogPayload): void {
        this.log("critical", payload);
    }

    public alert(payload: LogPayload): void {
        this.log("alert", payload);
    }

    public emergency(payload: LogPayload): void {
        this.log("emergency", payload);
    }

    protected mapToMongoDBLogLevel(level: LogLevel): "info" | "warn" | "error" | "debug" | "fatal" {
        switch (level) {
            case "info":
                return "info";
            case "warning":
                return "warn";
            case "error":
                return "error";
            case "notice":
            case "debug":
                return "debug";
            case "critical":
            case "alert":
            case "emergency":
                return "fatal";
            default:
                return "info";
        }
    }
}

export class ConsoleLogger extends LoggerBase {
    protected readonly type: LoggerType = "console";

    public constructor(keychain: Keychain) {
        super(keychain);
    }

    protected logCore(level: LogLevel, payload: InternalLogPayload): void {
        const { id, context, message } = payload;
        // eslint-disable-next-line no-console
        console.error(
            `[${level.toUpperCase()}] ${id.__value} - ${context}: ${message} (${process.pid}${this.serializeAttributes(payload.attributes)})`
        );
    }

    private serializeAttributes(attributes?: Record<string, string>): string {
        if (!attributes || Object.keys(attributes).length === 0) {
            return "";
        }
        return `, ${Object.entries(attributes)
            .map(([key, value]) => `${key}=${value}`)
            .join(", ")}`;
    }
}

export class DiskLogger extends LoggerBase<{ initialized: [] }> {
    private bufferedMessages: { level: LogLevel; payload: InternalLogPayload }[] = [];
    private logWriter?: MongoLogWriter;

    public constructor(logPath: string, onError: (error: Error) => void, keychain: Keychain) {
        super(keychain);

        void this.initialize(logPath, onError);
    }

    private async initialize(logPath: string, onError: (error: Error) => void): Promise<void> {
        try {
            await fs.mkdir(logPath, { recursive: true });

            const manager = new MongoLogManager({
                directory: logPath,
                retentionDays: 30,
                // eslint-disable-next-line no-console
                onwarn: console.warn,
                // eslint-disable-next-line no-console
                onerror: console.error,
                gzip: false,
                retentionGB: 1,
            });

            await manager.cleanupOldLogFiles();

            this.logWriter = await manager.createLogWriter();

            for (const message of this.bufferedMessages) {
                this.logCore(message.level, message.payload);
            }
            this.bufferedMessages = [];
            this.emit("initialized");
        } catch (error: unknown) {
            onError(error as Error);
        }
    }

    protected type: LoggerType = "disk";

    protected logCore(level: LogLevel, payload: InternalLogPayload): void {
        if (!this.logWriter) {
            // If the log writer is not initialized, buffer the message
            this.bufferedMessages.push({ level, payload });
            return;
        }

        const { id, context, message } = payload;
        const mongoDBLevel = this.mapToMongoDBLogLevel(level);

        this.logWriter[mongoDBLevel]("MONGODB-MCP", id, context, message, payload.attributes);
    }
}

export class McpLogger<TUserConfig extends UserConfig = UserConfig, TContext = unknown> extends LoggerBase {
    public static readonly LOG_LEVELS: LogLevel[] = [
        "debug",
        "info",
        "notice",
        "warning",
        "error",
        "critical",
        "alert",
        "emergency",
    ] as const;

    public constructor(
        private readonly server: Server<TUserConfig, TContext>,
        keychain: Keychain
    ) {
        super(keychain);
    }

    protected readonly type: LoggerType = "mcp";

    protected logCore(level: LogLevel, payload: InternalLogPayload): void {
        // Only log if the server is connected
        if (!this.server.mcpServer.isConnected()) {
            return;
        }

        const minimumLevel = McpLogger.LOG_LEVELS.indexOf(this.server.mcpLogLevel);
        const currentLevel = McpLogger.LOG_LEVELS.indexOf(level);
        if (minimumLevel > currentLevel) {
            // Don't log if the requested level is lower than the minimum level
            return;
        }

        void this.server.mcpServer.server.sendLoggingMessage({
            level,
            data: `[${payload.context}]: ${payload.message}`,
        });
    }
}

export class CompositeLogger extends LoggerBase {
    protected readonly type?: LoggerType;

    private readonly loggers: LoggerBase[] = [];
    private readonly attributes: Record<string, string> = {};

    constructor(...loggers: LoggerBase[]) {
        // composite logger does not redact, only the actual delegates do the work
        // so we don't need the Keychain here
        super(undefined);

        this.loggers = loggers;
    }

    public addLogger(logger: LoggerBase): void {
        this.loggers.push(logger);
    }

    public log(level: LogLevel, payload: LogPayload): void {
        // The composite does not redact — each child handles its own redaction.
        this.onLogEvent({ level, payload });

        for (const logger of this.loggers) {
            const attributes =
                Object.keys(this.attributes).length > 0 || payload.attributes
                    ? { ...this.attributes, ...payload.attributes }
                    : undefined;
            logger.log(level, { ...payload, attributes });
        }
    }

    protected logCore(): void {
        throw new Error("logCore should never be invoked on CompositeLogger");
    }

    public setAttribute(key: string, value: string): void {
        this.attributes[key] = value;
    }
}
