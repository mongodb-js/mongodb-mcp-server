import { z } from "zod";
import {
    type ConfigFieldMeta,
    commaSeparatedToArray,
    getExportsPath,
    getLogPath,
    oneWayOverride,
    onlyLowerThanBaseValueOverride,
    onlyStricterLogLevelOverride,
    onlySubsetOfBaseValueOverride,
    parseBoolean,
} from "./configUtils.js";
import { MCP_LOG_LEVELS } from "@mongodb-js/mcp-core";
import { monitoringServerFeatureValues, previewFeatureValues } from "../schemas.js";
import { argMetadata, CliOptionsSchema as MongoshCliOptionsSchema } from "@mongosh/arg-parser/arg-parser";
import { TRANSPORT_PAYLOAD_LIMITS } from "../../transports/constants.js";

export const configRegistry = z.registry<ConfigFieldMeta>();

const ServerConfigSchema = z.object({
    apiBaseUrl: z
        .string()
        .default("https://cloud.mongodb.com/")
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    assistantBaseUrl: z
        .string()
        .default("https://knowledge.mongodb.com/api/v1/")
        .describe("Base URL for the MongoDB Assistant API.")
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    apiClientId: z
        .string()
        .optional()
        .describe("Atlas API client ID for authentication. Required for running Atlas tools.")
        .register(configRegistry, { isSecret: true, overrideBehavior: "not-allowed" }),
    apiClientSecret: z
        .string()
        .optional()
        .describe("Atlas API client secret for authentication. Required for running Atlas tools.")
        .register(configRegistry, { isSecret: true, overrideBehavior: "not-allowed" }),
    connectionString: z
        .string()
        .optional()
        .describe(
            "MongoDB connection string for direct database connections. Optional, if not set, you'll need to call the connect tool before interacting with MongoDB data."
        )
        .register(configRegistry, { isSecret: true, overrideBehavior: "not-allowed" }),
    loggers: z
        .preprocess(
            (val: string | string[] | undefined) => commaSeparatedToArray(val),
            z.array(z.enum(["stderr", "disk", "mcp"]))
        )
        .check(
            z.minLength(1, "Cannot be an empty array"),
            z.refine((val) => new Set(val).size === val.length, {
                message: "Duplicate loggers found in config",
            })
        )
        .default(["disk", "mcp"])
        .describe("An array of logger types.")
        .register(configRegistry, {
            defaultValueDescription: '`"disk,mcp"` see below*',
            overrideBehavior: "not-allowed",
        }),
    logPath: z
        .string()
        .default(getLogPath())
        .describe("Folder to store logs.")
        .register(configRegistry, { defaultValueDescription: "see below*", overrideBehavior: "not-allowed" }),
    mcpClientLogLevel: z
        .enum(MCP_LOG_LEVELS)
        .default("debug")
        .describe("Minimum severity level for log messages forwarded to the MCP client.")
        .register(configRegistry, { overrideBehavior: onlyStricterLogLevelOverride(MCP_LOG_LEVELS) }),
    disabledTools: z
        .preprocess((val: string | string[] | undefined) => commaSeparatedToArray(val), z.array(z.string()))
        .default([])
        .describe("An array of tool names, operation types, and/or categories of tools that will be disabled.")
        .register(configRegistry, { overrideBehavior: "merge" }),
    confirmationRequiredTools: z
        .preprocess((val: string | string[] | undefined) => commaSeparatedToArray(val), z.array(z.string()))
        .default([
            "atlas-create-access-list",
            "atlas-create-db-user",
            "drop-database",
            "drop-collection",
            "delete-many",
            "drop-index",
            "atlas-streams-manage",
            "atlas-streams-teardown",
        ])
        .describe(
            "An array of tool names that require user confirmation before execution. Requires the client to support elicitation."
        )
        .register(configRegistry, { overrideBehavior: "merge" }),
    readOnly: z
        .preprocess(parseBoolean, z.boolean())
        .default(false)
        .describe(
            "When set to true, only allows read, connect, and metadata operation types, disabling create/update/delete operations."
        )
        .register(configRegistry, {
            overrideBehavior: oneWayOverride(true),
        }),
    indexCheck: z
        .preprocess(parseBoolean, z.boolean())
        .default(false)
        .describe(
            "When set to true, enforces that query operations must use an index, rejecting queries that perform a collection scan."
        )
        .register(configRegistry, {
            overrideBehavior: oneWayOverride(true),
        }),
    telemetry: z
        .enum(["enabled", "disabled"])
        .default("enabled")
        .describe("When set to disabled, disables telemetry collection.")
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    transport: z
        .enum(["stdio", "http"])
        .default("stdio")
        .describe("Either 'stdio' or 'http'.")
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    httpPort: z.coerce
        .number()
        .int()
        .min(0, "Invalid httpPort: must be at least 0")
        .max(65535, "Invalid httpPort: must be at most 65535")
        .default(3000)
        .describe("Port number for the HTTP server (only used when transport is 'http'). Use 0 for a random port.")
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    httpHost: z
        .string()
        .default("127.0.0.1")
        .describe("Host address to bind the HTTP server to (only used when transport is 'http').")
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    httpHeaders: z
        .object({})
        .loose()
        .default({})
        .describe(
            "Header that the HTTP server will validate when making requests (only used when transport is 'http')."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    httpBodyLimit: z.coerce
        .number()
        .int()
        .min(
            TRANSPORT_PAYLOAD_LIMITS.http,
            `Invalid httpBodyLimit: must be at least ${TRANSPORT_PAYLOAD_LIMITS.http} bytes`
        )
        .default(TRANSPORT_PAYLOAD_LIMITS.http)
        .describe(
            "Maximum size of the HTTP request body in bytes (only used when transport is 'http'). This value is passed as the optional limit parameter to the Express.js json() middleware."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    idleTimeoutMs: z.coerce
        .number()
        .default(600_000)
        .describe("Idle timeout for a client to disconnect (only applies to http transport).")
        .register(configRegistry, { overrideBehavior: onlyLowerThanBaseValueOverride() }),
    notificationTimeoutMs: z.coerce
        .number()
        .default(540_000)
        .describe("Notification timeout for a client to be aware of disconnect (only applies to http transport).")
        .register(configRegistry, { overrideBehavior: onlyLowerThanBaseValueOverride() }),
    maxBytesPerQuery: z.coerce
        .number()
        .default(16_777_216)
        .describe(
            "The maximum size in bytes for results from a find or aggregate tool call. This serves as an upper bound for the responseBytesLimit parameter in those tools."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    maxDocumentsPerQuery: z.coerce
        .number()
        .default(100)
        .describe(
            "The maximum number of documents that can be returned by a find or aggregate tool call. For the find tool, the effective limit will be the smaller of this value and the tool's limit parameter."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    maxTimeMS: z.coerce
        .number()
        .int()
        .min(0, "maxTimeMS must be non-negative")
        .optional()
        .describe(
            "The maximum time in milliseconds that operations are allowed to run on the MongoDB server. When set, this value is passed as the maxTimeMS option to read operations such as find, aggregate, and count."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    exportsPath: z
        .string()
        .default(getExportsPath())
        .describe("Folder to store exported data files.")
        .register(configRegistry, { defaultValueDescription: "see below*", overrideBehavior: "not-allowed" }),
    exportTimeoutMs: z.coerce
        .number()
        .default(300_000)
        .describe("Time in milliseconds after which an export is considered expired and eligible for cleanup.")
        .register(configRegistry, { overrideBehavior: onlyLowerThanBaseValueOverride() }),
    exportCleanupIntervalMs: z.coerce
        .number()
        .default(120_000)
        .describe("Time in milliseconds between export cleanup cycles that remove expired export files.")
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    atlasTemporaryDatabaseUserLifetimeMs: z.coerce
        .number()
        .default(14_400_000)
        .describe(
            "Time in milliseconds that temporary database users created when connecting to MongoDB Atlas clusters will remain active before being automatically deleted."
        )
        .register(configRegistry, { overrideBehavior: onlyLowerThanBaseValueOverride() }),
    voyageApiKey: z
        .string()
        .default("")
        .describe(
            "API key for Voyage AI embeddings service (required for creating Atlas Local deployments with auto-embed vector search capabilities)."
        )
        .register(configRegistry, { isSecret: true, overrideBehavior: "not-allowed" }),
    previewFeatures: z
        .preprocess(
            (val: string | string[] | undefined) => commaSeparatedToArray(val),
            z.array(z.enum(previewFeatureValues))
        )
        .default([])
        .describe("An array of preview features that are enabled.")
        .register(configRegistry, { overrideBehavior: onlySubsetOfBaseValueOverride() }),
    allowRequestOverrides: z
        .preprocess(parseBoolean, z.boolean())
        .default(false)
        .describe(
            "When set to true, allows configuration values to be overridden via request headers and query parameters."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    dryRun: z
        .boolean()
        .default(false)
        .describe(
            "When true, runs the server in dry mode: dumps configuration and enabled tools, then exits without starting the server."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    externallyManagedSessions: z
        .boolean()
        .default(false)
        .describe(
            "When true, the HTTP transport allows requests with a session ID supplied externally through the 'mcp-session-id' header. When an external ID is supplied, the initialization request is optional."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    httpResponseType: z
        .enum(["sse", "json"])
        .default("sse")
        .describe(
            "The HTTP response type for tool responses: 'sse' for Server-Sent Events, 'json' for standard JSON responses."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    /** @deprecated Use `monitoringServerPort` instead. */
    healthCheckPort: z
        .number()
        .int()
        .min(0, "Invalid healthCheckPort: must be at least 0")
        .max(65535, "Invalid healthCheckPort: must be at most 65535")
        .optional()
        .describe(
            "Deprecated. Use `monitoringServerPort` instead. Port number for the healthCheck HTTP server (only used when transport is 'http'). If provided, `healthCheckHost` must also be set."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" })
        .register(argMetadata, { deprecationReplacement: "monitoringServerPort" }),
    /** @deprecated Use `monitoringServerHost` instead. */
    healthCheckHost: z
        .string()
        .optional()
        .describe(
            "Deprecated. Use `monitoringServerHost` instead. Host address to bind the healthCheck HTTP server to (only used when transport is 'http'). If provided, `healthCheckPort` must also be set."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" })
        .register(argMetadata, { deprecationReplacement: "monitoringServerHost" }),
    monitoringServerPort: z
        .number()
        .int()
        .min(0, "Invalid monitoringServerPort: must be at least 0")
        .max(65535, "Invalid monitoringServerPort: must be at most 65535")
        .optional()
        .describe(
            "Port number for the monitoring HTTP server (only used when transport is 'http'). If provided, `monitoringServerHost` must also be set."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    monitoringServerHost: z
        .string()
        .optional()
        .describe(
            "Host address to bind the monitoring HTTP server to (only used when transport is 'http'). If provided, `monitoringServerPort` must also be set."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
    monitoringServerFeatures: z
        .preprocess(
            (val: string | string[] | undefined) => commaSeparatedToArray(val),
            z.array(z.enum(monitoringServerFeatureValues))
        )
        .default(["health-check"])
        .describe(
            "Features to expose on the monitoring server (only used when transport is 'http' and monitoringServerHost/monitoringServerPort are set)."
        )
        .register(configRegistry, { overrideBehavior: "not-allowed" }),
});

export const UserConfigSchema = z.object({
    ...MongoshCliOptionsSchema.shape,
    ...ServerConfigSchema.shape,
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

export const ALL_CONFIG_KEYS = Object.keys(UserConfigSchema.shape) as (keyof UserConfig)[];
