import { z, type ZodString } from "zod";

export const CommonArgs = {
    string: (): ZodString =>
        z.string().regex(/^[\x20-\x7E]*$/, "String cannot contain special characters or Unicode symbols"),
};

export const AtlasArgs = {
    objectId: (fieldName: string): z.ZodString =>
        CommonArgs.string()
            .min(1, `${fieldName} is required`)
            .regex(/^[0-9a-fA-F]{24}$/, `${fieldName} must be a valid 24-character hexadecimal string`),

    projectId: (): z.ZodString => AtlasArgs.objectId("projectId"),

    organizationId: (): z.ZodString => AtlasArgs.objectId("organizationId"),

    clusterName: (): z.ZodString =>
        CommonArgs.string()
            .min(1, "Cluster name is required")
            .max(64, "Cluster name must be 64 characters or less")
            .regex(/^[^/]*$/, "String cannot contain '/'")
            .regex(/^[a-zA-Z0-9_-]+$/, "Cluster name can only contain letters, numbers, hyphens, and underscores"),

    projectName: (): z.ZodString =>
        CommonArgs.string()
            .min(1, "Project name is required")
            .max(64, "Project name must be 64 characters or less")
            .regex(/^[^/]*$/, "String cannot contain '/'")
            .regex(/^[a-zA-Z0-9_-]+$/, "Project name can only contain letters, numbers, hyphens, and underscores"),

    username: (): z.ZodString =>
        CommonArgs.string()
            .min(1, "Username is required")
            .max(100, "Username must be 100 characters or less")
            .regex(/^[^/]*$/, "String cannot contain '/'")
            .regex(/^[a-zA-Z0-9._-]+$/, "Username can only contain letters, numbers, dots, hyphens, and underscores"),

    ipAddress: (): z.ZodString => CommonArgs.string().ip({ version: "v4" }),

    cidrBlock: (): z.ZodString => CommonArgs.string().cidr(),

    region: (): z.ZodString =>
        CommonArgs.string()
            .min(1, "Region is required")
            .max(50, "Region must be 50 characters or less")
            .regex(/^[a-zA-Z0-9_-]+$/, "Region can only contain letters, numbers, hyphens, and underscores"),
};
