import { z, type ZodString } from "zod";

const ASCII_ONLY_NON_CC_REGEX = /^[\x20-\x7E]*$/;
export const ASCII_ONLY_NON_CC_ERROR = "String cannot contain control characters or non-ASCII characters";

export const CommonArgs = {
    asciiOnlyString: (): ZodString => z.string().regex(ASCII_ONLY_NON_CC_REGEX, ASCII_ONLY_NON_CC_ERROR),

    objectId: (fieldName: string): z.ZodString =>
        z
            .string()
            .min(1, `${fieldName} is required`)
            .length(24, `${fieldName} must be exactly 24 characters`)
            .regex(/^[0-9a-fA-F]+$/, `${fieldName} must contain only hexadecimal characters`),
};
