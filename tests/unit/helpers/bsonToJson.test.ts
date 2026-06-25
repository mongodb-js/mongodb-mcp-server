import { describe, expect, it } from "vitest";
import { BSONRegExp, Decimal128, Double, Int32, Long, ObjectId, Timestamp } from "bson";
import { bsonToJson } from "../../../src/helpers/bsonToJson.js";

describe("bsonToJson", () => {
    describe("BSON types that require Extended JSON", () => {
        it("serializes ObjectId to idiomatic Extended JSON", () => {
            const id = new ObjectId();
            expect(bsonToJson({ _id: id })).toEqual({ _id: { $oid: id.toHexString() } });
        });

        it("serializes Long values outside the JSON safe integer range as $numberLong", () => {
            const value = Long.fromString("123412341234");
            expect(bsonToJson({ bigInt: value })).toEqual({ bigInt: { $numberLong: "123412341234" } });
        });

        it("serializes small Long values as $numberLong", () => {
            const value = Long.fromString("10");
            expect(bsonToJson({ count: value })).toEqual({ count: { $numberLong: "10" } });
        });

        it("serializes Int32 as a plain number", () => {
            expect(bsonToJson({ count: new Int32(10) })).toEqual({ count: 10 });
        });

        it("serializes Double as a plain number", () => {
            expect(bsonToJson({ value: new Double(10.5) })).toEqual({ value: 10.5 });
        });

        it("serializes Decimal128 as $numberDecimal", () => {
            expect(bsonToJson({ value: Decimal128.fromString("10.5") })).toEqual({
                value: { $numberDecimal: "10.5" },
            });
        });

        it("serializes BSONRegExp as $regularExpression", () => {
            expect(bsonToJson({ pattern: new BSONRegExp("foo", "i") })).toEqual({
                pattern: { $regularExpression: { pattern: "foo", options: "i" } },
            });
        });

        it("serializes Timestamp as $timestamp", () => {
            expect(bsonToJson({ ts: new Timestamp({ t: 1, i: 2 }) })).toEqual({
                ts: { $timestamp: { t: 1, i: 2 } },
            });
        });

        it("serializes Date as $date", () => {
            const createdAt = new Date("2020-01-01T00:00:00.000Z");
            expect(bsonToJson({ createdAt })).toEqual({
                createdAt: { $date: "2020-01-01T00:00:00.000Z" },
            });
        });
    });

    describe("JSON-native values", () => {
        it("passes through strings, numbers, booleans, and null unchanged", () => {
            expect(
                bsonToJson({
                    name: "foo",
                    count: 10,
                    active: true,
                    missing: null,
                })
            ).toEqual({
                name: "foo",
                count: 10,
                active: true,
                missing: null,
            });
        });

        it("passes through nested plain objects and arrays unchanged", () => {
            expect(
                bsonToJson({
                    tags: ["a", "b"],
                    meta: { nested: { value: 1 } },
                })
            ).toEqual({
                tags: ["a", "b"],
                meta: { nested: { value: 1 } },
            });
        });
    });

    it("serializes document arrays for structured content", () => {
        const id = new ObjectId();
        const docs = [{ _id: id, name: "foo" }];
        expect(bsonToJson(docs)).toEqual([{ _id: { $oid: id.toHexString() }, name: "foo" }]);
    });
});
