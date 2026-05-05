import z, { type ZodString } from "zod";

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
