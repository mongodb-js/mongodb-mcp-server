import { z, type ZodString } from "zod";
import { EJSON } from "bson";

const NO_UNICODE_REGEX = /^[\x20-\x7E]*$/;
export const NO_UNICODE_ERROR = "String cannot contain special characters or Unicode symbols";

export const CommonArgs = {
    string: (): ZodString => z.string().regex(NO_UNICODE_REGEX, NO_UNICODE_ERROR),

    objectId: (fieldName: string): z.ZodString =>
        z
            .string()
            .min(1, `${fieldName} is required`)
            .length(24, `${fieldName} must be exactly 24 characters`)
            .regex(/^[0-9a-fA-F]+$/, `${fieldName} must contain only hexadecimal characters`),
};

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
