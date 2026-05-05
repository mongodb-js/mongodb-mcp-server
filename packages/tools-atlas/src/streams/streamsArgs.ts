import { z } from "zod";

export const StreamsArgs = {
    workspaceName: (): z.ZodString => z.string().min(1, "Workspace name is required"),
    connectionName: (): z.ZodString => z.string().min(1, "Connection name is required"),
    processorName: (): z.ZodString => z.string().min(1, "Processor name is required"),
};

// Connection configuration schemas used by streams tools
export const ConnectionConfig = z
    .object({
        bootstrapServers: z.string().optional(),
        authentication: z
            .object({
                mechanism: z.enum(["PLAIN", "SCRAM-256", "SCRAM-512"]).optional(),
                username: z.string().optional(),
                password: z.string().optional(),
            })
            .optional(),
        security: z
            .object({
                protocol: z.enum(["SASL_SSL", "SASL_PLAINTEXT", "SSL"]).optional(),
            })
            .optional(),
        clusterName: z.string().optional(),
        dbRoleToExecute: z
            .object({
                role: z.string(),
                type: z.enum(["BUILT_IN", "CUSTOM"]),
            })
            .optional(),
        aws: z
            .object({
                roleArn: z.string().optional(),
            })
            .optional(),
        url: z.string().optional(),
        schemaRegistryUrls: z.array(z.string()).optional(),
        schemaRegistryAuthentication: z
            .object({
                type: z.enum(["USER_INFO", "SASL_INHERIT"]).optional(),
                username: z.string().optional(),
                password: z.string().optional(),
            })
            .optional(),
        provider: z.enum(["CONFLUENT"]).optional(),
        networking: z
            .object({
                access: z
                    .object({
                        type: z.enum(["PUBLIC", "PRIVATE_LINK"]),
                    })
                    .optional(),
            })
            .optional(),
    })
    .passthrough();

export const PrivateLinkConfig = z.object({
    provider: z.enum(["AWS", "AZURE", "GCP"]),
    vendor: z.enum(["CONFLUENT", "MSK", "S3", "KINESIS", "EVENTHUB"]).optional(),
    region: z.string().optional(),
    serviceEndpointId: z.string().optional(),
    dnsDomain: z.string().optional(),
    dnsSubDomain: z.array(z.string()).optional(),
    arn: z.string().optional(),
    azureResourceIds: z.array(z.string()).optional(),
    gcpServiceAttachmentUris: z.array(z.string()).optional(),
});
