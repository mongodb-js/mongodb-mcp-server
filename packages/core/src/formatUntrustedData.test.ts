import { describe, it, expect } from "vitest";
import { formatUntrustedData } from "./toolBase.js";

describe("formatUntrustedData", () => {
    it("wraps data in untrusted-user-data tags with a warning by default", () => {
        const result = formatUntrustedData({}, "Found 2 documents.", "doc1", "doc2");

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: "text", text: "Found 2 documents." });
        expect(result[1]?.text).toMatch(
            /<untrusted-user-data-[0-9a-f-]+>\ndoc1\ndoc2\n<\/untrusted-user-data-[0-9a-f-]+>/
        );
        expect(result[1]?.text).toContain("WARNING");
    });

    it("returns data as-is when disableUntrustedDataWarning is set", () => {
        const result = formatUntrustedData({ disableUntrustedDataWarning: true }, "Found 2 documents.", "doc1", "doc2");

        expect(result).toEqual([
            { type: "text", text: "Found 2 documents." },
            { type: "text", text: "doc1\ndoc2" },
        ]);
    });

    it("returns only the description when there is no data", () => {
        expect(formatUntrustedData({}, "No documents.")).toEqual([{ type: "text", text: "No documents." }]);
        expect(formatUntrustedData({ disableUntrustedDataWarning: true }, "No documents.")).toEqual([
            { type: "text", text: "No documents." },
        ]);
    });
});
