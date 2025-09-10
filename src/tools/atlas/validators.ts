import { z, type ZodString } from "zod";

export const ToolArgs = {
    string: (): ZodString =>
        z.string().regex(/^[\x20-\x7E]*$/, "String cannot contain special characters or Unicode symbols"),
};

/**
 * Common Zod validators for Atlas tools
 * These can be reused across different Atlas tools for consistent validation
 */
export const AtlasArgs = {
    objectId: (fieldName: string): z.ZodString =>
        ToolArgs.string()
            .min(1, `${fieldName} is required`)
            .regex(/^[0-9a-fA-F]{24}$/, `${fieldName} must be a valid 24-character hexadecimal string`),

    projectId: (): z.ZodString => AtlasArgs.objectId("projectId"),

    organizationId: (): z.ZodString => AtlasArgs.objectId("organizationId"),

    clusterName: (): z.ZodString =>
        ToolArgs.string()
            .min(1, "Cluster name is required")
            .max(64, "Cluster name must be 64 characters or less")
            .regex(/^[a-zA-Z0-9_-]+$/, "Cluster name can only contain letters, numbers, hyphens, and underscores"),

    username: (): z.ZodString =>
        ToolArgs.string()
            .min(1, "Username is required")
            .max(100, "Username must be 100 characters or less")
            .regex(/^[a-zA-Z0-9._-]+$/, "Username can only contain letters, numbers, dots, hyphens, and underscores"),

    ipAddress: (): z.ZodString => ToolArgs.string().ip({ version: "v4" }),

    cidrBlock: (): z.ZodString =>
        ToolArgs.string().regex(
            /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/,
            "Must be a valid CIDR block (e.g., 192.168.1.0/24)"
        ),

    region: (): z.ZodString =>
        ToolArgs.string().regex(
            /^[a-zA-Z0-9_-]+$/,
            "Region can only contain letters, numbers, hyphens, and underscores"
        ),
};
