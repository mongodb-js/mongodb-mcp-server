import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { decodeGeneric } from "@blackwell-systems/gcf";
import { formatUntrustedData } from "./toolBase.js";

function uniformDocs(n: number): Record<string, unknown>[] {
    return Array.from({ length: n }, (_, i) => ({
        _id: `doc-${i}`,
        name: `Item ${i}`,
        status: i % 2 === 0 ? "active" : "inactive",
        score: i * 3,
        region: ["us-east", "eu-west", "ap-south"][i % 3],
    }));
}

// Pulls the payload back out of the security-wrapped block that formatUntrustedData emits.
function wrappedPayload(blocks: { text: string; type: "text" }[]): string {
    const match = blocks[1]?.text.match(/<untrusted-user-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-user-data-/);
    return match?.[1] ?? "";
}

// The GCF decoder returns objects as Maps; convert to plain objects for comparison.
function toPlain(value: unknown): unknown {
    if (value instanceof Map) {
        return Object.fromEntries([...value.entries()].map(([k, v]) => [k, toPlain(v)]));
    }
    if (Array.isArray(value)) {
        return value.map(toPlain);
    }
    return value;
}

describe("GCF output format (formatUntrustedData)", () => {
    beforeEach(() => {
        delete process.env.MDB_MCP_OUTPUT_FORMAT;
    });
    afterEach(() => {
        delete process.env.MDB_MCP_OUTPUT_FORMAT;
    });

    it("returns JSON unchanged by default", () => {
        const docs = uniformDocs(20);
        const json = JSON.stringify(docs);

        const payload = wrappedPayload(formatUntrustedData("Found 20 documents", json));

        expect(payload).toBe(json);
        expect(payload).not.toContain("GCF profile=generic");
    });

    it("encodes a record array as GCF when MDB_MCP_OUTPUT_FORMAT=gcf, losslessly", () => {
        process.env.MDB_MCP_OUTPUT_FORMAT = "gcf";
        const docs = uniformDocs(20);

        const payload = wrappedPayload(formatUntrustedData("Found 20 documents", JSON.stringify(docs)));

        expect(payload.startsWith("GCF profile=generic")).toBe(true);
        expect(payload.length).toBeLessThan(JSON.stringify(docs).length);
        expect(toPlain(decodeGeneric(payload))).toEqual(docs); // round-trips back to the documents
    });

    it("keeps JSON for a payload GCF cannot shrink (never-grow)", () => {
        process.env.MDB_MCP_OUTPUT_FORMAT = "gcf";
        const json = JSON.stringify({ ok: true });

        const payload = wrappedPayload(formatUntrustedData("Result", json));

        expect(payload).toBe(json);
    });

    it("leaves non-JSON data unchanged", () => {
        process.env.MDB_MCP_OUTPUT_FORMAT = "gcf";

        const payload = wrappedPayload(formatUntrustedData("Message", "a plain non-JSON string"));

        expect(payload).toBe("a plain non-JSON string");
    });
});
