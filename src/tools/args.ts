import { z, type ZodString } from "zod";
import { EJSON } from "bson";

const NO_UNICODE_REGEX = /^[\x20-\x7E]*$/;
export const NO_UNICODE_ERROR = "String cannot contain special characters or Unicode symbols";

const ALLOWED_USERNAME_CHARACTERS_REGEX = /^[a-zA-Z0-9._-]+$/;
export const ALLOWED_USERNAME_CHARACTERS_ERROR =
    "Username can only contain letters, numbers, dots, hyphens, and underscores";

const ALLOWED_REGION_CHARACTERS_REGEX = /^[a-zA-Z0-9_-]+$/;
export const ALLOWED_REGION_CHARACTERS_ERROR = "Region can only contain letters, numbers, hyphens, and underscores";

const ALLOWED_CLUSTER_NAME_CHARACTERS_REGEX = /^[a-zA-Z0-9_-]+$/;
export const ALLOWED_CLUSTER_NAME_CHARACTERS_ERROR =
    "Cluster names can only contain ASCII letters, numbers, and hyphens.";

const ALLOWED_PROJECT_NAME_CHARACTERS_REGEX = /^[a-zA-Z0-9\s()@&+:._',-]+$/;
export const ALLOWED_PROJECT_NAME_CHARACTERS_ERROR =
    "Project names can't be longer than 64 characters and can only contain letters, numbers, spaces, and the following symbols: ( ) @ & + : . _ - ' ,";

export const CommonArgs = {
    string: (): ZodString => z.string().regex(NO_UNICODE_REGEX, NO_UNICODE_ERROR),

    objectId: (fieldName: string): z.ZodString =>
        z
            .string()
            .min(1, `${fieldName} is required`)
            .length(24, `${fieldName} must be exactly 24 characters`)
            .regex(/^[0-9a-fA-F]+$/, `${fieldName} must contain only hexadecimal characters`),
};

// Note: AtlasArgs has been moved to @mongodb-js/mcp-tools-atlas package
// The local copy in packages/tools-atlas/src/args.ts should be used instead

export function toEJSON<T extends object | undefined>(value: T): T {
    if (!value) {
        return value;
    }

    return EJSON.deserialize(value, { relaxed: false }) as T;
}

// The runtime schema is a ZodPipe (object → EJSON transform), but we advertise
// it as a ZodRecord so the public API surface renders cleanly as { [key: string]: unknown }
export function zEJSON(): z.ZodRecord<z.ZodString, z.ZodUnknown> {
    return z.object({}).loose().transform(toEJSON) as unknown as z.ZodRecord<z.ZodString, z.ZodUnknown>;
}
