import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeToolName, parseClaudeTurn } from "./parseClaudeToolCalls.js";

describe("normalizeToolName", () => {
    it("passes through the server-name form the claude TUI emits", () => {
        expect(normalizeToolName("mongo")).toBe("mongo");
    });
    it("still normalizes dotted/underscored MCP names", () => {
        expect(normalizeToolName("mongo.list-databases")).toBe("list-databases");
        expect(normalizeToolName("mcp__mongo__list-databases")).toBe("list-databases");
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
        const result = parseClaudeTurn({ claudeHomeDir: home });
        expect(result.toolCalls).toHaveLength(1); // deduped
        expect(result.toolCalls[0]?.name).toBe("list-databases");
        expect(result.toolCalls[0]?.rawName).toBe("mcp__mongo__list-databases");
        expect(result.toolCalls[0]?.args).toEqual({ connectionId: "preconfigured" });
    });

    it("does not re-attribute JSONL tool calls seen by an earlier turn (per-session dedupe)", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-parse-jsonl-"));
        const proj = path.join(home, "projects", "some-dir");
        fs.mkdirSync(proj, { recursive: true });
        const sessionFile = path.join(proj, "session.jsonl");
        const appendToolUse = (block: Record<string, unknown>): void => {
            fs.appendFileSync(
                sessionFile,
                JSON.stringify({ message: { role: "assistant", content: [{ type: "tool_use", ...block }] } }) + "\n"
            );
        };

        // Turn 1: list-databases is called and attributed once.
        appendToolUse({ id: "t1", name: "mcp__mongo__list-databases", input: { connectionId: "preconfigured" } });
        const seenCallKeys = new Set<string>();
        const turn1 = parseClaudeTurn({ claudeHomeDir: home, seenCallKeys });
        expect(turn1.toolCalls.map((tc) => tc.name)).toEqual(["list-databases"]);

        // Turn 2 (same session): earlier call skipped; only the new `find` call is returned.
        appendToolUse({ id: "t2", name: "mcp__mongo__find", input: { collection: "c" } });
        const turn2 = parseClaudeTurn({ claudeHomeDir: home, seenCallKeys });
        expect(turn2.toolCalls.map((tc) => tc.name)).toEqual(["find"]);
    });
});
