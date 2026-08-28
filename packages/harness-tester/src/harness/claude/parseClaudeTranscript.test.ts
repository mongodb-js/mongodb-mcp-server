import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeToolName, parseClaudeTranscript, parseClaudeTurn } from "./parseClaudeTranscript.js";

describe("normalizeToolName", () => {
    it("passes through the server-name form the claude TUI emits", () => {
        expect(normalizeToolName("mongo")).toBe("mongo");
    });
    it("still normalizes dotted/underscored MCP names", () => {
        expect(normalizeToolName("mongo.list-databases")).toBe("list-databases");
        expect(normalizeToolName("mcp__mongo__list-databases")).toBe("list-databases");
    });
});

describe("parseClaudeTranscript", () => {
    it("parses a happy-path turn: Called marker + reply", () => {
        const transcript = [
            '❯ Use the "list-databases" tool, then reply with the database names.',
            "",
            "  Called mongo",
            "",
            "⏺ The available databases are:",
            "",
            "  1. admin (8 KB)",
            "  2. config (12 KB)",
            "  3. local (16 KB)",
            "",
            "❯",
        ].join("\n");
        const result = parseClaudeTranscript(transcript);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0]?.name).toBe("mongo");
    });

    it("returns no tool calls when none happened", () => {
        const result = parseClaudeTranscript("❯ Use the tool, then reply.");
        expect(result.toolCalls).toHaveLength(0);
    });
});

describe("parseClaudeTurn with session JSONL", () => {
    it("merges exact mcp__mongo__<tool> calls + args from the session JSONL", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-parse-jsonl-"));
        const proj = path.join(home, "projects", "some-dir");
        fs.mkdirSync(proj, { recursive: true });
        fs.writeFileSync(
            path.join(proj, "session.jsonl"),
            [
                JSON.stringify({
                    message: {
                        role: "assistant",
                        content: [
                            { type: "text", text: "Let me query." },
                            {
                                type: "tool_use",
                                id: "t1",
                                name: "mcp__mongo__list-databases",
                                input: { connectionId: "preconfigured" },
                            },
                        ],
                    },
                }),
                JSON.stringify({
                    message: {
                        role: "assistant",
                        content: [
                            {
                                type: "tool_use",
                                id: "t2",
                                name: "mcp__mongo__list-databases",
                                input: { connectionId: "preconfigured" },
                            },
                        ],
                    },
                }),
            ].join("\n")
        );
        const result = parseClaudeTurn({ transcript: "", claudeHomeDir: home });
        expect(result.toolCalls).toHaveLength(1); // deduped
        expect(result.toolCalls[0]?.name).toBe("list-databases");
        expect(result.toolCalls[0]?.rawName).toBe("mcp__mongo__list-databases");
        expect(result.toolCalls[0]?.args).toEqual({ connectionId: "preconfigured" });
    });

    it("falls back to the transcript's server-level Called marker when no JSONL exists", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-parse-jsonl-"));
        const result = parseClaudeTurn({ transcript: "  Called mongo 2 times\n❯", claudeHomeDir: home });
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0]?.name).toBe("mongo");
    });
});
