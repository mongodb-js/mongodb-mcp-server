import { z } from "zod";
import { EJSON } from "bson";
import { ANY_ADDITIONAL_PROPERTIES } from "@mongodb-js/mcp-core";

function deserializeEJSON<T extends object | undefined>(value: T): T {
    if (!value) {
        return value;
    }

    return EJSON.deserialize(value, { relaxed: false }) as T;
}

export function zEJSON(): z.ZodRecord<z.ZodString, z.ZodUnknown> {
    return z.object({}).loose().meta(ANY_ADDITIONAL_PROPERTIES).transform(deserializeEJSON) as unknown as z.ZodRecord<
        z.ZodString,
        z.ZodUnknown
    >;
}
