import { normalizeToolName } from "../shared.js";
import type { ToolCallRecord } from "../types.js";

export { normalizeToolName };

export interface TuiTranscriptParseResult {
    toolCalls: ToolCallRecord[];
}

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

export function parseTuiTranscript(transcript: string): TuiTranscriptParseResult {
    return {
        toolCalls: collectToolCalls(transcript),
    };
}
