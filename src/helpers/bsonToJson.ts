import { objectToIdiomaticEJSON } from "hadron-document";

/**
 * Converts a BSON value into a JSON-safe object using Compass idiomatic Extended JSON.
 *
 * ObjectId becomes `{ "$oid": "..." }`, Long becomes `{ "$numberLong": "..." }`, etc.
 */
export function bsonToJson(value: Record<string, unknown>): Record<string, unknown>;
export function bsonToJson(value: unknown): unknown;
export function bsonToJson(value: unknown): unknown {
    return JSON.parse(objectToIdiomaticEJSON(value));
}

/**
 * Serializes an array of BSON objects.
 */
export function serializeBsonToJsonObjects(objects: unknown[]): unknown[] {
    return objects.map((object) => bsonToJson(object));
}
