import { z } from "zod";
import { EJSON } from "bson";

export function toEJSON<T extends object | undefined>(value: T): T {
    if (!value) {
        return value;
    }

    return EJSON.deserialize(value, { relaxed: false }) as T;
}

export function zEJSON(): z.ZodRecord<z.ZodString, z.ZodUnknown> {
    return z.object({}).loose().transform(toEJSON) as unknown as z.ZodRecord<z.ZodString, z.ZodUnknown>;
}
