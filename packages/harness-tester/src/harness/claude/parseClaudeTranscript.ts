import fs from "node:fs";
import path from "node:path";
import { normalizeToolName } from "../shared.js";
import type { ToolCallRecord } from "../types.js";

export { normalizeToolName };

export interface ClaudeTranscriptParseResult {
    toolCalls: ToolCallRecord[];
    replyText: string;
}

const COMPOSER_IDLE_LINE = "❯";

/** Server-level tool calls seen in the TUI transcript (`Called <server> N times`). */
function collectServerCalls(transcript: string): ToolCallRecord[] {
    const toolCalls: ToolCallRecord[] = [];
    const seen = new Set<string>();
    for (const line of transcript.split("\n")) {
        const match = line.match(/\s*Called\s+([^\s(]+)/);
        if (!match) {
            continue;
        }
        const rawName = match[1] ?? "";
        const name = normalizeToolName(rawName);
        const dedupeKey = name;
        if (seen.has(dedupeKey)) {
            continue;
        }
        seen.add(dedupeKey);
        toolCalls.push({ name, rawName });
    }
    return toolCalls;
}

/**
 * Exact tool calls from the session JSONL claude writes per session under
 * `$CLAUDE_CONFIG_DIR/projects/<dir>/<session>.jsonl`.
 */
export function collectSessionJsonlToolCalls(claudeHomeDir: string): ToolCallRecord[] {
    const projectsDir = path.join(claudeHomeDir, "projects");
    const records: ToolCallRecord[] = [];
    const seen = new Set<string>();
    const collectFrom = (file: string): void => {
        let text: string;
        try {
            text = fs.readFileSync(file, "utf8");
        } catch {
            return;
        }
        for (const line of text.split("\n")) {
            if (!line.trim()) {
                continue;
            }
            let entry: unknown;
            try {
                entry = JSON.parse(line);
            } catch {
                continue;
            }
            if (typeof entry !== "object" || entry === null) {
                continue;
            }
            const msg = (entry as { message?: { content?: unknown } }).message;
            const content = msg?.content;
            if (!Array.isArray(content)) {
                continue;
            }
            for (const block of content) {
                if (typeof block !== "object" || block === null) {
                    continue;
                }
                const b = block as { type?: string; name?: string; input?: unknown };
                if (b.type !== "tool_use" || !b.name) {
                    continue;
                }
                const rawName = b.name;
                const name = normalizeToolName(rawName);
                const dedupeKey = `${name}::${JSON.stringify(b.input ?? null)}`;
                if (seen.has(dedupeKey)) {
                    continue;
                }
                seen.add(dedupeKey);
                records.push({ name, rawName, args: b.input });
            }
        }
    };
    const walk = (dir: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const fp = path.join(dir, e.name);
            if (e.isDirectory()) {
                walk(fp);
            } else if (e.name.endsWith(".jsonl")) {
                collectFrom(fp);
            }
        }
    };
    try {
        if (fs.existsSync(projectsDir)) {
            walk(projectsDir);
        }
    } catch {
        // best-effort; the transcript-level server calls still apply
    }
    return records;
}

/**
 * Extract the final assistant reply: the last contiguous `⏺` text block before
 * the composer idle line. Returns "" when the transcript has no composer idle
 * line (incomplete turn).
 */
function extractReply(transcript: string): string {
    const idleIdx = transcript.lastIndexOf(COMPOSER_IDLE_LINE);
    if (idleIdx < 0) {
        return "";
    }
    const blocks: string[][] = [];
    let current: string[] = [];
    const pushBlock = (): void => {
        if (current.length > 0) {
            blocks.push(current);
        }
        current = [];
    };
    for (const line of transcript.slice(0, idleIdx).split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue; // blank lines inside a block (e.g. between a ⏺ header and its list) stay in the block
        }
        if (trimmed.startsWith("⏺")) {
            pushBlock();
            current = [trimmed.replace(/^⏺\s*/, "")];
        } else if (trimmed.startsWith("❯") || trimmed.startsWith("›") || /^[\s─═╭╰│┌┐└┘├┤]+$/.test(trimmed)) {
            pushBlock();
        } else if (current.length > 0) {
            current.push(trimmed);
        }
    }
    pushBlock();

    for (let b = blocks.length - 1; b >= 0; b--) {
        const block = blocks[b];
        if (!block) {
            continue;
        }
        const text = block.join("\n").trim();
        if (!text || text.startsWith("Called ")) {
            continue;
        }
        return text;
    }
    return "";
}

export interface ParseClaudeTurnOptions {
    transcript: string;
    /** Hermetic `CLAUDE_CONFIG_DIR`; when set, exact tool calls are merged from the session JSONL. */
    claudeHomeDir?: string;
}

export function parseClaudeTurn({ transcript, claudeHomeDir }: ParseClaudeTurnOptions): ClaudeTranscriptParseResult {
    const serverCalls = collectServerCalls(transcript);
    const sessionCalls = claudeHomeDir ? collectSessionJsonlToolCalls(claudeHomeDir) : [];
    // Session JSONL tool calls are precise; fall back to the transcript's
    // server-level markers when the JSONL isn't readable (e.g. on a fresh
    // session with no persisted log yet).
    return {
        toolCalls: sessionCalls.length > 0 ? sessionCalls : serverCalls,
        replyText: extractReply(transcript),
    };
}

export function parseClaudeTranscript(transcript: string): ClaudeTranscriptParseResult {
    return parseClaudeTurn({ transcript });
}
