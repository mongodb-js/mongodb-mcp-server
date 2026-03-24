import { z } from "zod";

const ALLOWED_STREAMS_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const ALLOWED_STREAMS_NAME_ERROR = "Name can only contain ASCII letters, numbers, hyphens, and underscores";

/** Typed schema for connectionConfig — all fields optional to support elicitation of partial configs. */
export const ConnectionConfig = z
    .object({
        // Kafka
        bootstrapServers: z
            .union([z.string(), z.array(z.string())])
            .transform((val) => (Array.isArray(val) ? val.join(",") : val))
            .optional()
            .describe(
                "Comma-separated Kafka broker addresses (e.g. 'broker1:9092,broker2:9092'). " +
                    "Also accepts an array of strings, which will be joined with commas."
            ),
        authentication: z
            .object({
                mechanism: z.enum(["PLAIN", "SCRAM-256", "SCRAM-512", "OAUTHBEARER"]).optional(),
                username: z.string().optional(),
                password: z.string().optional(),
            })
            .passthrough()
            .optional()
            .describe("Kafka authentication config."),
        security: z
            .object({
                protocol: z.enum(["SASL_SSL", "SASL_PLAINTEXT", "SSL"]).optional(),
            })
            .passthrough()
            .optional()
            .describe("Kafka security config."),
        // Cluster
        clusterName: z.string().optional().describe("Atlas cluster name for Cluster connections."),
        dbRoleToExecute: z
            .object({
                role: z.string().optional(),
                type: z.enum(["BUILT_IN", "CUSTOM"]).optional(),
            })
            .optional()
            .describe("Database role. Defaults to {role: 'readWriteAnyDatabase', type: 'BUILT_IN'}."),
        // AWS (S3, Kinesis, Lambda)
        aws: z
            .object({
                roleArn: z.string().optional().describe("IAM role ARN registered via Atlas Cloud Provider Access."),
                testBucket: z.string().optional().describe("S3 test bucket name (optional, S3 only)."),
            })
            .passthrough()
            .optional()
            .describe("AWS config for S3, Kinesis, and Lambda connections."),
        // Https
        url: z.string().optional().describe("Webhook URL for Https connections."),
        headers: z.record(z.string()).optional().describe("HTTP headers for Https connections."),
        // SchemaRegistry
        provider: z
            .string()
            .optional()
            .describe(
                "Schema registry provider (e.g. 'CONFLUENT'). Only for SchemaRegistry connections. Defaults to 'CONFLUENT'."
            ),
        schemaRegistryUrls: z
            .union([z.array(z.string()), z.string()])
            .transform((val) => (typeof val === "string" ? val.split(",").map((s) => s.trim()) : val))
            .optional()
            .describe(
                "Schema registry URL(s) as an array of strings. " +
                    "Also accepts a single comma-separated string, which will be split into an array."
            ),
        schemaRegistryAuthentication: z
            .object({
                type: z.enum(["USER_INFO", "SASL_INHERIT"]).optional(),
                username: z.string().optional(),
                password: z.string().optional(),
            })
            .passthrough()
            .optional()
            .describe("Schema registry auth. Defaults to USER_INFO."),
        // Networking (Kafka PrivateLink/VPC peering)
        networking: z
            .object({
                access: z
                    .object({
                        type: z.string().optional(),
                        connectionId: z.string().optional(),
                    })
                    .passthrough()
                    .optional(),
            })
            .passthrough()
            .optional()
            .describe("Private networking config (PrivateLink or VPC peering). Kafka only."),
    })
    .passthrough();

/** Typed schema for privateLinkConfig — provider is required, all other fields optional and per-provider. */
export const PrivateLinkConfig = z
    .object({
        // Common
        provider: z.enum(["AWS", "AZURE", "GCP"]).describe("Cloud provider for the PrivateLink endpoint. Required."),
        region: z
            .string()
            .optional()
            .describe(
                "Cloud region for the PrivateLink endpoint. Required for all vendors except AWS MSK. Use cloud-native region names: AWS 'us-east-1', Azure 'eastus2', GCP 'us-central1'."
            ),
        // AWS
        vendor: z
            .string()
            .optional()
            .describe(
                "PrivateLink vendor. If the user does not specify a vendor, ask them which vendor to use before proceeding. If they decline or say none, omit this field — the Atlas API will default to GENERIC. Valid values — AWS: 'CONFLUENT', 'MSK', 'KINESIS', 'S3'. Azure: 'EVENTHUB', 'CONFLUENT'. GCP: 'CONFLUENT'."
            ),
        arn: z.string().optional().describe("Amazon Resource Name (ARN). Required for AWS MSK vendor."),
        dnsDomain: z
            .string()
            .optional()
            .describe(
                "DNS domain hostname. Required for AWS CONFLUENT, AZURE EVENTHUB, AZURE CONFLUENT, and GCP CONFLUENT."
            ),
        dnsSubDomain: z
            .array(z.string())
            .optional()
            .describe(
                "DNS subdomains. Each value must contain the dnsDomain. Required for AWS CONFLUENT (use [] for serverless clusters)."
            ),
        // Azure
        serviceEndpointId: z
            .string()
            .optional()
            .describe(
                "Service endpoint ID. Required for AWS CONFLUENT, AWS S3, AWS KINESIS, and AZURE EVENTHUB. Do NOT provide for AZURE CONFLUENT or GCP CONFLUENT."
            ),
        azureResourceIds: z
            .array(z.string())
            .optional()
            .describe(
                "Azure Resource IDs. Required for AZURE CONFLUENT (instead of serviceEndpointId). Do NOT provide for AZURE EVENTHUB."
            ),
        // GCP
        gcpServiceAttachmentUris: z
            .array(z.string())
            .optional()
            .describe("GCP Private Service Connect attachment URIs. Required for GCP CONFLUENT."),
    })
    .passthrough();

export const StreamsArgs = {
    workspaceName: (): z.ZodString =>
        z
            .string()
            .min(1, "Workspace name is required")
            .max(64, "Workspace name must be 64 characters or less")
            .regex(ALLOWED_STREAMS_NAME_REGEX, ALLOWED_STREAMS_NAME_ERROR),

    processorName: (): z.ZodString =>
        z
            .string()
            .min(1, "Processor name is required")
            .max(64, "Processor name must be 64 characters or less")
            .regex(ALLOWED_STREAMS_NAME_REGEX, ALLOWED_STREAMS_NAME_ERROR),

    connectionName: (): z.ZodString =>
        z
            .string()
            .min(1, "Connection name is required")
            .max(64, "Connection name must be 64 characters or less")
            .regex(ALLOWED_STREAMS_NAME_REGEX, ALLOWED_STREAMS_NAME_ERROR),
};
