import { z, type ZodString } from "zod";

const ASCII_ONLY_NON_CC_REGEX = /^[\x20-\x7E]*$/;
export const ASCII_ONLY_NON_CC_ERROR = "String cannot contain control characters or non-ASCII characters";

/**
 * Metadata for an object schema that accepts any extra fields, such as `.loose()`, `.passthrough()` or
 * `z.record(z.string(), z.unknown())`. Zod advertises those extra fields as the empty schema
 * `additionalProperties: {}`, which some MCP clients reject as untyped. Pass this to `.meta()` so the
 * advertised JSON Schema says `additionalProperties: true`, which means the same thing. Validation is unchanged.
 */
export const ANY_ADDITIONAL_PROPERTIES = { additionalProperties: true } as const;

/**
 * Metadata for an array schema whose elements can be any value, such as `z.array(z.unknown())`. Zod advertises
 * those elements as the empty schema `items: {}`, which some MCP clients reject as untyped. Pass this to `.meta()`
 * so the advertised JSON Schema leaves `items` out, which means the same thing. Validation is unchanged.
 */
export const ANY_ARRAY_ITEMS = { items: undefined } as const;

export const CommonArgs = {
    asciiOnlyString: (): ZodString => z.string().regex(ASCII_ONLY_NON_CC_REGEX, ASCII_ONLY_NON_CC_ERROR),

    objectId: (fieldName: string): z.ZodString =>
        z
            .string()
            .min(1, `${fieldName} is required`)
            .length(24, `${fieldName} must be exactly 24 characters`)
            .regex(/^[0-9a-fA-F]+$/, `${fieldName} must contain only hexadecimal characters`),
};
