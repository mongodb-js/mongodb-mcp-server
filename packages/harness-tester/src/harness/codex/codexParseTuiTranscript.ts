import { normalizeToolName } from "../shared.js";
import type { ToolCallRecord } from "../types.js";

export { normalizeToolName };

export interface TuiTranscriptParseResult {
    toolCalls: ToolCallRecord[];
    replyText: string;
}

const COMPOSER_IDLE_LINE = "Ask Codex to do anything";

function collectToolCalls(transcript: string): ToolCallRecord[] {
    const toolCalls: ToolCallRecord[] = [];
    const seen = new Set<string>();
    for (const line of transcript.split("\n")) {
        const match = line.match(/•\s*Called\s+([^\s(]+)\s*\(/);
        if (!match) {
            continue;
        }
        const rawName = match[1] ?? "";
        const name = normalizeToolName(rawName);
        const argsStart = line.indexOf("(", match.index ?? line.indexOf("(")) + 1;
        const argsEnd = line.lastIndexOf(")");
        const argsText = argsEnd > argsStart ? line.slice(argsStart, argsEnd).trim() : "";
        let args: unknown;
        try {
            args = argsText ? JSON.parse(argsText) : undefined;
        } catch {
            args = argsText;
        }
        const dedupeKey = `${name}::${argsText}`;
        if (seen.has(dedupeKey)) {
            continue;
        }
        seen.add(dedupeKey);
        toolCalls.push({ name, rawName, args });
    }
    return toolCalls;
}

/**
 * Extract the final assistant reply: the last contiguous `•` text block before
 * the composer idle line, excluding tool-call bullets. Returns "" when the
 * transcript has no composer idle line (incomplete turn).
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
            pushBlock();
            continue;
        }
        if (trimmed.startsWith("•")) {
            pushBlock();
            current = [trimmed.replace(/^•\s*/, "")];
        } else if (trimmed.startsWith("›") || /^[\s─═╭╰│┌┐└┘├┤]+$/.test(trimmed)) {
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

export function parseTuiTranscript(transcript: string): TuiTranscriptParseResult {
    return {
        toolCalls: collectToolCalls(transcript),
        replyText: extractReply(transcript),
    };
}
