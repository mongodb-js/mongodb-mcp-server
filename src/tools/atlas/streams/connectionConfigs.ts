import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const AuthenticationSchema = z
    .object({
        mechanism: z.enum(["PLAIN", "SCRAM-256", "SCRAM-512", "OAUTHBEARER"]).optional(),
        username: z.string().optional(),
        password: z.string().optional(),
    })
    .passthrough();

const SecuritySchema = z
    .object({
        protocol: z.enum(["SASL_SSL", "SASL_PLAINTEXT", "SSL", "PLAINTEXT"]).optional(),
    })
    .passthrough();

const NetworkingSchema = z
    .object({
        access: z
            .object({
                type: z.string().optional(),
                connectionId: z.string().optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export const KafkaConnectionConfig = z
    .object({
        bootstrapServers: z
            .union([z.string(), z.array(z.string())])
            .transform((val) => (Array.isArray(val) ? val.join(",") : val))
            .optional(),
        authentication: AuthenticationSchema.optional(),
        security: SecuritySchema.optional(),
        networking: NetworkingSchema.optional(),
    })
    .strict();

export const ClusterConnectionConfig = z
    .object({
        clusterName: z.string().optional(),
        dbRoleToExecute: z
            .object({
                role: z.string().optional(),
                type: z.enum(["BUILT_IN", "CUSTOM"]).optional(),
            })
            .optional(),
        networking: NetworkingSchema.optional(),
    })
    .strict();

const AwsCredentialsSchema = z
    .object({
        roleArn: z.string().optional(),
        testBucket: z.string().optional(),
    })
    .passthrough();

export const S3ConnectionConfig = z
    .object({
        aws: AwsCredentialsSchema.optional(),
        networking: NetworkingSchema.optional(),
    })
    .strict();

export const KinesisConnectionConfig = z
    .object({
        aws: AwsCredentialsSchema.optional(),
        networking: NetworkingSchema.optional(),
    })
    .strict();

export const LambdaConnectionConfig = z
    .object({
        aws: AwsCredentialsSchema.optional(),
        networking: NetworkingSchema.optional(),
    })
    .strict();

export const HttpsConnectionConfig = z
    .object({
        url: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        networking: NetworkingSchema.optional(),
    })
    .strict();

export const SchemaRegistryConnectionConfig = z
    .object({
        provider: z.string().optional(),
        schemaRegistryUrls: z
            .union([z.array(z.string()), z.string()])
            .transform((val) => (typeof val === "string" ? val.split(",").map((s) => s.trim()) : val))
            .optional(),
        schemaRegistryAuthentication: z
            .object({
                type: z.enum(["USER_INFO", "SASL_INHERIT"]).optional(),
                username: z.string().optional(),
                password: z.string().optional(),
            })
            .passthrough()
            .optional(),
    })
    .strict();

export const PrivateLinkConnectionConfig = z
    .object({
        provider: z.enum(["AWS", "AZURE", "GCP"]),
        region: z.string().optional(),
        vendor: z.string().optional(),
        arn: z.string().optional(),
        dnsDomain: z.string().optional(),
        dnsSubDomain: z.array(z.string()).optional(),
        serviceEndpointId: z.string().optional(),
        azureResourceIds: z.array(z.string()).optional(),
        gcpServiceAttachmentUris: z.array(z.string()).optional(),
    })
    .passthrough();

/**
 * Fields that cannot be patched on an existing connection. Kept on the create-mode
 * schema (so users can set them at creation time), stripped from the update-mode
 * derivation (so users get a useful error if they try to patch them).
 */
const IMMUTABLE_AFTER_CREATE = ["networking"] as const;

/**
 * Derives an update-mode schema from a create-mode schema by:
 * 1. omitting immutable fields that exist on the schema (can only be set at create time), and
 * 2. making every remaining field optional (PATCH semantics — any field not sent
 *    is left unchanged on the server).
 *
 * Unknown-key rejection (cross-type safety) is preserved because the underlying
 * schemas are `.strict()`. Immutable keys that aren't present on a given schema are
 * skipped — `.omit()` in zod rejects unknown keys.
 */
function toUpdateMode(schema: z.ZodObject<z.ZodRawShape>): z.ZodTypeAny {
    const shapeKeys = Object.keys(schema.shape);
    const omitMask: Record<string, true> = {};
    for (const key of IMMUTABLE_AFTER_CREATE) {
        if (shapeKeys.includes(key)) {
            omitMask[key] = true;
        }
    }
    const omitted = Object.keys(omitMask).length > 0 ? schema.omit(omitMask as never) : schema;
    return omitted.partial();
}

export type SchemaMode = "create" | "update";

/**
 * Validates a connection config against the per-type schema for the given connectionType
 * and mode, returning a CallToolResult on rejection or null on success / when no schema
 * is defined for the type (e.g. Sample, unknown types fall through to Atlas).
 *
 * Used by `build.createConnection` (create mode) and `manage.updateConnection` (update
 * mode) to fail fast with a useful message instead of letting Atlas return a generic 400.
 */
export function rejectInvalidConnectionConfig(
    config: Record<string, unknown>,
    connectionType: string,
    mode: SchemaMode
): CallToolResult | null {
    const schema = getConnectionConfigSchema(connectionType, mode);
    if (!schema) return null;
    const result = schema.safeParse(config);
    if (result.success) return null;

    const unknownFields = result.error.issues
        .filter((issue) => issue.code === "unrecognized_keys")
        .flatMap((issue) => ("keys" in issue ? issue.keys : []));
    const modeNoun = mode === "update" ? "update" : "connection";
    const unknownFieldList =
        unknownFields.length > 0
            ? `Unknown or forbidden fields for ${connectionType} ${modeNoun}: ${unknownFields.join(", ")}.`
            : `The config contains fields that are not valid for a ${connectionType} ${modeNoun}.`;
    const guidance =
        mode === "update"
            ? "Some fields are immutable after creation (e.g. networking). " +
              "Remove the unrelated fields, or to change an immutable field delete and recreate the connection."
            : "Check the connectionType matches the config you provided. " +
              "Remove the unrelated fields or switch to the correct connectionType.";

    return {
        content: [
            {
                type: "text",
                text: `Invalid ${connectionType} ${modeNoun} config: ${unknownFieldList}\n\n${guidance}`,
            },
        ],
        isError: true,
    };
}

function getCreateSchema(connectionType: string): z.ZodObject<z.ZodRawShape> | null {
    switch (connectionType) {
        case "Kafka":
            return KafkaConnectionConfig;
        case "Cluster":
            return ClusterConnectionConfig;
        case "S3":
            return S3ConnectionConfig;
        case "AWSKinesisDataStreams":
            return KinesisConnectionConfig;
        case "AWSLambda":
            return LambdaConnectionConfig;
        case "Https":
            return HttpsConnectionConfig;
        case "SchemaRegistry":
            return SchemaRegistryConnectionConfig;
        default:
            return null;
    }
}

export function getConnectionConfigSchema(connectionType: string, mode: SchemaMode = "create"): z.ZodTypeAny | null {
    const createSchema = getCreateSchema(connectionType);
    if (!createSchema) return null;
    return mode === "update" ? toUpdateMode(createSchema) : createSchema;
}
