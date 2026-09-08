import { describe, expect, it } from "vitest";
import { normalizeToolName, parseTuiTranscript } from "./codexParseTuiTranscript.js";

describe("normalizeToolName", () => {
    it("normalizes dot-separated server.tool names (codex TUI format)", () => {
        expect(normalizeToolName("mongo.list-databases")).toBe("list-databases");
        expect(normalizeToolName("mongo.create-collection")).toBe("create-collection");
        expect(normalizeToolName("list-databases")).toBe("list-databases");
    });

    it("still normalizes mcp__-prefixed names (legacy JSONL format)", () => {
        expect(normalizeToolName("mcp__mongodb__list-databases")).toBe("list-databases");
        expect(normalizeToolName("mcp__list-databases")).toBe("list-databases");
    });
});

describe("parseTuiTranscript", () => {
    it("extracts tool calls from a happy-path transcript", () => {
        const transcript = [
            "› Use the list-databases tool.",
            "",
            "• I'll query the server and list the database names.",
            "",
            '• Called mongo.list-databases({"connectionId":"preconfigured"})',
            "  └ Found 3 databases: admin, test, mydb",
            "",
            "───────────────",
            "",
            "• The databases are: admin, test, mydb.",
            "",
            "───────────────",
            "",
            "› Ask Codex to do anything",
        ].join("\n");

        const result = parseTuiTranscript(transcript);
        expect(result.toolCalls).toContainEqual(
            expect.objectContaining({
                name: "list-databases",
                rawName: "mongo.list-databases",
                args: { connectionId: "preconfigured" },
            })
        );
    });

    it("deduplicates identical tool calls", () => {
        const transcript = [
            "› Do the work.",
            "",
            '• Called mongo.list-databases({"connectionId":"preconfigured"})',
            "  └ Found: admin",
            "",
            '• Called mongo.list-databases({"connectionId":"preconfigured"})',
            "  └ Found: admin",
            "",
            "• Done.",
            "",
            "› Ask Codex to do anything",
        ].join("\n");

        const result = parseTuiTranscript(transcript);
        const lists = result.toolCalls.filter((tc) => tc.name === "list-databases");
        expect(lists).toHaveLength(1);
    });

    it("returns no tool calls from noise-only content", () => {
        const transcript = "• Working (3s • esc to interrupt)\njust noise";
        const result = parseTuiTranscript(transcript);
        expect(result.toolCalls).toEqual([]);
    });
});
