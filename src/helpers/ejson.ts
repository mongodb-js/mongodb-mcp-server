import { EJSON, Long } from "bson";

/**
 * Pre-processes an object by converting BSON Long values into EJSON format
 * if they exceed the JavaScript safe integer limits. Safe Long values are
 * converted to standard JavaScript numbers to maintain readability.
 *
 * Note: Recursion is restricted to plain objects (proto is Object.prototype or null)
 * and arrays to avoid traversing and corrupting other BSON wrapper types (e.g. ObjectId, Binary).
 */
export function serializeSafeLongs(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (
        obj instanceof Long ||
        (typeof obj === "object" && "_bsontype" in obj && (obj as Record<string, unknown>)._bsontype === "Long")
    ) {
        const longObj = obj as unknown as Long;
        const isSafe =
            longObj.lessThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER)) &&
            longObj.greaterThanOrEqual(Long.fromNumber(Number.MIN_SAFE_INTEGER));
        if (isSafe) {
            return longObj.toNumber();
        }
        return { $numberLong: longObj.toString() };
    }

    if (Array.isArray(obj)) {
        return obj.map(serializeSafeLongs);
    }

    if (typeof obj === "object") {
        const proto: unknown = Object.getPrototypeOf(obj);
        if (proto === null || proto === Object.prototype) {
            const result: Record<string, unknown> = {};
            for (const key of Object.keys(obj)) {
                result[key] = serializeSafeLongs((obj as Record<string, unknown>)[key]);
            }
            return result;
        }
    }

    return obj;
}

/**
 * Custom EJSON stringifier that preserves 64-bit integer precision for unsafe Longs.
 */
export function stringifyEJSON(
    value: unknown,
    replacer?: ((this: unknown, key: string, value: unknown) => unknown) | (string | number)[] | null,
    space?: string | number
): string {
    return EJSON.stringify(serializeSafeLongs(value), replacer as Parameters<typeof EJSON.stringify>[1], space);
}
