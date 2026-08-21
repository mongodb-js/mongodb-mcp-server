import { objectToIdiomaticEJSON } from "hadron-document";

/**
 * Converts a BSON value into a JSON-safe object using Compass idiomatic Extended JSON.
 *
 * ObjectId becomes `{ "$oid": "..." }`, Long becomes `{ "$numberLong": "..." }`, etc.
 */
export function bsonToJson(value: Record<string, unknown>): Record<string, unknown>;
export function bsonToJson(value: unknown[]): unknown[];
export function bsonToJson(value: unknown): unknown;
export function bsonToJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => bsonToJson(item));
    }
    return JSON.parse(objectToIdiomaticEJSON(value));
}
