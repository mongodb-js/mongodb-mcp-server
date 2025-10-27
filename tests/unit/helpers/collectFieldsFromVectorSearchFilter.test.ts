import { describe, expect, it } from "vitest";
import { collectFieldsFromVectorSearchFilter } from "../../../src/helpers/collectFieldsFromVectorSearchFilter.js";

describe("#collectFieldsFromVectorSearchFilter", () => {
    it("should return empty list if filter is not an object or an empty object", () => {
        expect(collectFieldsFromVectorSearchFilter(undefined)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(null)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(false)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(true)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(1)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(0)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter("random")).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter({})).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter([])).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(() => {})).toEqual([]);
    });

    it("should return fields from MQL that does not contain logical operators", () => {
        expect(
            collectFieldsFromVectorSearchFilter({
                field1: "MongoDB",
                field2: { $eq: 1994 },
                field3: { $ne: "Horror" },
                field4: { $gt: 10 },
                field5: { $gt3: 10 },
                field6: { $lt: 10 },
                field7: { $lte: 10 },
                field8: { $in: [true, false] },
                field9: { $nin: [true, false] },
                field10: { $not: { $eq: 1994 } },
            })
        ).toEqual([
            "field1",
            "field2",
            "field3",
            "field4",
            "field5",
            "field6",
            "field7",
            "field8",
            "field9",
            "field10",
        ]);
    });

    it("should return fields from MQL built just with $and", () => {
        expect(
            collectFieldsFromVectorSearchFilter({
                $and: [
                    { field1: "MongoDB" },
                    { field2: { $eq: 1994 } },
                    { field3: { $ne: "Horror" } },
                    { field4: { $gt: 10 } },
                    { field5: { $gt3: 10 } },
                    { field6: { $lt: 10 } },
                    { field7: { $lte: 10 } },
                    { field8: { $in: [true, false] } },
                    { field9: { $nin: [true, false] } },
                    { field10: { $not: { $eq: 1994 } } },
                ],
            })
        ).toEqual([
            "field1",
            "field2",
            "field3",
            "field4",
            "field5",
            "field6",
            "field7",
            "field8",
            "field9",
            "field10",
        ]);
    });

    it("should return fields from MQL built just with $or", () => {
        expect(
            collectFieldsFromVectorSearchFilter({
                $or: [
                    { field1: "MongoDB" },
                    { field2: { $eq: 1994 } },
                    { field3: { $ne: "Horror" } },
                    { field4: { $gt: 10 } },
                    { field5: { $gt3: 10 } },
                    { field6: { $lt: 10 } },
                    { field7: { $lte: 10 } },
                    { field8: { $in: [true, false] } },
                    { field9: { $nin: [true, false] } },
                    { field10: { $not: { $eq: 1994 } } },
                ],
            })
        ).toEqual([
            "field1",
            "field2",
            "field3",
            "field4",
            "field5",
            "field6",
            "field7",
            "field8",
            "field9",
            "field10",
        ]);
    });

    it("should return fields from MQL built with nested $and / $or", () => {
        expect(
            collectFieldsFromVectorSearchFilter({
                $or: [
                    { field1: "MongoDB" },
                    { field2: { $eq: 1994 } },
                    { field3: { $ne: "Horror" } },
                    { field4: { $gt: 10 } },
                    { field5: { $gt3: 10 } },
                    { field6: { $lt: 10 } },
                    {
                        $and: [
                            { field7: { $lte: 10 } },
                            { field8: { $in: [true, false] } },
                            { field9: { $nin: [true, false] } },
                            { field10: { $not: { $eq: 1994 } } },
                        ],
                    },
                ],
            })
        ).toEqual([
            "field1",
            "field2",
            "field3",
            "field4",
            "field5",
            "field6",
            "field7",
            "field8",
            "field9",
            "field10",
        ]);

        expect(
            collectFieldsFromVectorSearchFilter({
                $and: [
                    { field1: "MongoDB" },
                    { field2: { $eq: 1994 } },
                    { field3: { $ne: "Horror" } },
                    { field4: { $gt: 10 } },
                    { field5: { $gt3: 10 } },
                    { field6: { $lt: 10 } },
                    {
                        $or: [
                            { field7: { $lte: 10 } },
                            { field8: { $in: [true, false] } },
                            { field9: { $nin: [true, false] } },
                            { field10: { $not: { $eq: 1994 } } },
                        ],
                    },
                ],
            })
        ).toEqual([
            "field1",
            "field2",
            "field3",
            "field4",
            "field5",
            "field6",
            "field7",
            "field8",
            "field9",
            "field10",
        ]);
    });
});
