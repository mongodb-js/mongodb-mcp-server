import { describe, expect, it } from "vitest";
import { Long, ObjectId } from "bson";
import { bsonToJson } from "../../../src/helpers/bsonToJson.js";

describe("safeBsonJson", () => {
    it("serializes ObjectId to idiomatic Extended JSON", () => {
        const id = new ObjectId();
        expect(bsonToJson({ _id: id })).toEqual({ _id: { $oid: id.toHexString() } });
    });

    it("serializes Long to idiomatic Extended JSON", () => {
        const value = Long.fromString("123412341234");
        expect(bsonToJson({ bigInt: value })).toEqual({ bigInt: { $numberLong: "123412341234" } });
    });

    it("serializes document arrays for structured content", () => {
        const id = new ObjectId();
        const docs = [{ _id: id, name: "foo" }];
        expect(bsonToJson(docs)).toEqual([{ _id: { $oid: id.toHexString() }, name: "foo" }]);
    });
});
