import { CommonArgs } from "@mongodb-js/mcp-core";
import { z } from "zod";

export { CommonArgs };

const ALLOWED_USERNAME_CHARACTERS_REGEX = /^[a-zA-Z0-9._-]+$/;
export const ALLOWED_USERNAME_CHARACTERS_ERROR =
    "Username can only contain letters, numbers, dots, hyphens, and underscores";

// Generic pattern for identifiers that permit only ASCII letters, numbers, hyphens, and underscores.
export const ALPHANUMERIC_DASH_UNDERSCORE_REGEX = /^[a-zA-Z0-9_-]+$/;

const ALLOWED_REGION_CHARACTERS_REGEX = ALPHANUMERIC_DASH_UNDERSCORE_REGEX;
export const ALLOWED_REGION_CHARACTERS_ERROR = "Region can only contain letters, numbers, hyphens, and underscores";

const ALLOWED_CLUSTER_NAME_CHARACTERS_REGEX = ALPHANUMERIC_DASH_UNDERSCORE_REGEX;
export const ALLOWED_CLUSTER_NAME_CHARACTERS_ERROR =
    "Cluster names can only contain ASCII letters, numbers, and hyphens.";

const ALLOWED_PROJECT_NAME_CHARACTERS_REGEX = /^[a-zA-Z0-9\s()@&+:._',-]+$/;
export const ALLOWED_PROJECT_NAME_CHARACTERS_ERROR =
    "Project names can't be longer than 64 characters and can only contain letters, numbers, spaces, and the following symbols: ( ) @ & + : . _ - ' ,";

export const AtlasArgs = {
    projectId: (): z.ZodString => CommonArgs.objectId("projectId"),

    organizationId: (): z.ZodString => CommonArgs.objectId("organizationId"),

    clusterName: (): z.ZodString =>
        z
            .string()
            .min(1, "Cluster name is required")
            .max(64, "Cluster name must be 64 characters or less")
            .regex(ALLOWED_CLUSTER_NAME_CHARACTERS_REGEX, ALLOWED_CLUSTER_NAME_CHARACTERS_ERROR),

    connectionType: (): z.ZodDefault<
        z.ZodEnum<{ standard: "standard"; private: "private"; privateEndpoint: "privateEndpoint" }>
    > => z.enum(["standard", "private", "privateEndpoint"]).default("standard"),

    projectName: (): z.ZodString =>
        z
            .string()
            .min(1, "Project name is required")
            .max(64, "Project name must be 64 characters or less")
            .regex(ALLOWED_PROJECT_NAME_CHARACTERS_REGEX, ALLOWED_PROJECT_NAME_CHARACTERS_ERROR),

    username: (): z.ZodString =>
        z
            .string()
            .min(1, "Username is required")
            .max(100, "Username must be 100 characters or less")
            .regex(ALLOWED_USERNAME_CHARACTERS_REGEX, ALLOWED_USERNAME_CHARACTERS_ERROR),

    ipAddress: (): z.ZodString => z.string().ipv4(),

    cidrBlock: (): z.ZodString => z.string().cidrv4(),

    region: (): z.ZodString =>
        z
            .string()
            .min(1, "Region is required")
            .max(50, "Region must be 50 characters or less")
            .regex(ALLOWED_REGION_CHARACTERS_REGEX, ALLOWED_REGION_CHARACTERS_ERROR),

    password: (): z.ZodString =>
        z.string().min(1, "Password is required").max(100, "Password must be 100 characters or less"),
};
