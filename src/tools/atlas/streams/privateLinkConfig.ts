import { z } from "zod";

/**
 * Input-layer schema for PrivateLink connections.
 *
 * PrivateLink has a different lifecycle from generic connections — it hits a
 * dedicated Atlas endpoint (`createPrivateLinkConnection`), has no update flow
 * (delete + recreate to change), and the body is a provider-discriminated union.
 * Kept in its own file so the pattern difference is easy to spot; referenced
 * from `connectionConfigs.ts`'s type-dispatch switch so every connection type
 * flows through a single validation entry point.
 */
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
