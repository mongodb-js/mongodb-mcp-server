import { z as z4 } from "zod/v4";
import { type CliOptions } from "@mongosh/arg-parser";
import { type ConfigFieldMeta, commaSeparatedToArray, getExportsPath, getLogPath } from "./configUtils.js";
import { previewFeatureValues, similarityValues } from "../schemas.js";

// TODO: UserConfig should only be UserConfigSchema and not an intersection with
// CliOptions. When we pull apart these two interfaces, we should fix this type
// as well.
export type UserConfig = z4.infer<typeof UserConfigSchema> & CliOptions;

export const configRegistry = z4.registry<ConfigFieldMeta>();

export const UserConfigSchema = z4.object({
    apiBaseUrl: z4.string().default("https://cloud.mongodb.com/"),
    apiClientId: z4
        .string()
        .optional()
        .describe("Atlas API client ID for authentication. Required for running Atlas tools.")
        .register(configRegistry, { isSecret: true }),
    apiClientSecret: z4
        .string()
        .optional()
        .describe("Atlas API client secret for authentication. Required for running Atlas tools.")
        .register(configRegistry, { isSecret: true }),
    connectionString: z4
        .string()
        .optional()
        .describe(
            "MongoDB connection string for direct database connections. Optional, if not set, you'll need to call the connect tool before interacting with MongoDB data."
        )
        .register(configRegistry, { isSecret: true }),
    loggers: z4
        .preprocess(
            (val: string | string[] | undefined) => commaSeparatedToArray(val),
            z4.array(z4.enum(["stderr", "disk", "mcp"]))
        )
        .check(
            z4.minLength(1, "Cannot be an empty array"),
            z4.refine((val) => new Set(val).size === val.length, {
                message: "Duplicate loggers found in config",
            })
        )
        .default(["disk", "mcp"])
        .describe("An array of logger types.")
        .register(configRegistry, {
            defaultValueDescription: '`"disk,mcp"` see below*',
        }),
    logPath: z4
        .string()
        .default(getLogPath())
        .describe("Folder to store logs.")
        .register(configRegistry, { defaultValueDescription: "see below*" }),
    disabledTools: z4
        .preprocess((val: string | string[] | undefined) => commaSeparatedToArray(val), z4.array(z4.string()))
        .default([])
        .describe("An array of tool names, operation types, and/or categories of tools that will be disabled."),
    confirmationRequiredTools: z4
        .preprocess((val: string | string[] | undefined) => commaSeparatedToArray(val), z4.array(z4.string()))
        .default([
            "atlas-create-access-list",
            "atlas-create-db-user",
            "drop-database",
            "drop-collection",
            "delete-many",
            "drop-index",
        ])
        .describe(
            "An array of tool names that require user confirmation before execution. Requires the client to support elicitation."
        ),
    readOnly: z4
        .boolean()
        .default(false)
        .describe(
            "When set to true, only allows read, connect, and metadata operation types, disabling create/update/delete operations."
        ),
    indexCheck: z4
        .boolean()
        .default(false)
        .describe(
            "When set to true, enforces that query operations must use an index, rejecting queries that perform a collection scan."
        ),
    telemetry: z4
        .enum(["enabled", "disabled"])
        .default("enabled")
        .describe("When set to disabled, disables telemetry collection."),
    transport: z4.enum(["stdio", "http"]).default("stdio").describe("Either 'stdio' or 'http'."),
    httpPort: z4.coerce
        .number()
        .int()
        .min(1, "Invalid httpPort: must be at least 1")
        .max(65535, "Invalid httpPort: must be at most 65535")
        .default(3000)
        .describe("Port number for the HTTP server (only used when transport is 'http')."),
    httpHost: z4
        .string()
        .default("127.0.0.1")
        .describe("Host address to bind the HTTP server to (only used when transport is 'http')."),
    httpHeaders: z4
        .object({})
        .passthrough()
        .default({})
        .describe(
            "Header that the HTTP server will validate when making requests (only used when transport is 'http')."
        ),
    idleTimeoutMs: z4.coerce
        .number()
        .default(600_000)
        .describe("Idle timeout for a client to disconnect (only applies to http transport)."),
    notificationTimeoutMs: z4.coerce
        .number()
        .default(540_000)
        .describe("Notification timeout for a client to be aware of disconnect (only applies to http transport)."),
    maxBytesPerQuery: z4.coerce
        .number()
        .default(16_777_216)
        .describe(
            "The maximum size in bytes for results from a find or aggregate tool call. This serves as an upper bound for the responseBytesLimit parameter in those tools."
        ),
    maxDocumentsPerQuery: z4.coerce
        .number()
        .default(100)
        .describe(
            "The maximum number of documents that can be returned by a find or aggregate tool call. For the find tool, the effective limit will be the smaller of this value and the tool's limit parameter."
        ),
    exportsPath: z4
        .string()
        .default(getExportsPath())
        .describe("Folder to store exported data files.")
        .register(configRegistry, { defaultValueDescription: "see below*" }),
    exportTimeoutMs: z4.coerce
        .number()
        .default(300_000)
        .describe("Time in milliseconds after which an export is considered expired and eligible for cleanup."),
    exportCleanupIntervalMs: z4.coerce
        .number()
        .default(120_000)
        .describe("Time in milliseconds between export cleanup cycles that remove expired export files."),
    atlasTemporaryDatabaseUserLifetimeMs: z4.coerce
        .number()
        .default(14_400_000)
        .describe(
            "Time in milliseconds that temporary database users created when connecting to MongoDB Atlas clusters will remain active before being automatically deleted."
        ),
    voyageApiKey: z4
        .string()
        .default("")
        .describe(
            "API key for Voyage AI embeddings service (required for vector search operations with text-to-embedding conversion)."
        )
        .register(configRegistry, { isSecret: true }),
    disableEmbeddingsValidation: z4
        .boolean()
        .default(false)
        .describe("When set to true, disables validation of embeddings dimensions."),
    vectorSearchDimensions: z4.coerce
        .number()
        .default(1024)
        .describe("Default number of dimensions for vector search embeddings."),
    vectorSearchSimilarityFunction: z4
        .enum(similarityValues)
        .default("euclidean")
        .describe("Default similarity function for vector search: 'euclidean', 'cosine', or 'dotProduct'."),
    previewFeatures: z4
        .preprocess(
            (val: string | string[] | undefined) => commaSeparatedToArray(val),
            z4.array(z4.enum(previewFeatureValues))
        )
        .default([])
        .describe("An array of preview features that are enabled."),
});
