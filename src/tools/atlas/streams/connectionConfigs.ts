import { z } from "zod";

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

export function getConnectionConfigSchema(connectionType: string): z.ZodTypeAny | null {
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
