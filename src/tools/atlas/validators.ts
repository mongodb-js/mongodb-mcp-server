import { z } from "zod";
/**
 * Common Zod validators for Atlas tools
 * These can be reused across different Atlas tools for consistent validation
 */
export const AtlasArgs = {
    objectId: (fieldName: string): z.ZodString =>
        z
            .string()
            .min(1, `${fieldName} is required`)
            .regex(/^[0-9a-fA-F]{24}$/, `${fieldName} must be a valid 24-character hexadecimal string`),

    projectId: (): z.ZodString => AtlasArgs.objectId("Project ID"),

    organizationId: (): z.ZodString => AtlasArgs.objectId("Organization ID"),

    clusterName: (): z.ZodString =>
        z
            .string()
            .min(1, "Cluster name is required")
            .max(64, "Cluster name must be 64 characters or less")
            .regex(/^[a-zA-Z0-9_-]+$/, "Cluster name can only contain letters, numbers, hyphens, and underscores"),

    username: (): z.ZodString =>
        z
            .string()
            .min(1, "Username is required")
            .max(100, "Username must be 100 characters or less")
            .regex(/^[a-zA-Z0-9._-]+$/, "Username can only contain letters, numbers, dots, hyphens, and underscores"),

    ipAddress: (): z.ZodString => z.string().ip({ version: "v4" }),

    cidrBlock: (): z.ZodString =>
        z.string().regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/, "Must be a valid CIDR block (e.g., 192.168.1.0/24)"),

    region: (): z.ZodString =>
        z.string().regex(/^[a-zA-Z0-9_-]+$/, "Region can only contain letters, numbers, hyphens, and underscores"),
};
