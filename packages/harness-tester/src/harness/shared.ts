import fs from "node:fs";
import path from "node:path";
import type { Backend } from "@microsoft/tui-test";

/**
 * Canonical path for config keys that agents match against their view of the
 * filesystem (codex `projects.<path>`, claude trust entries). macOS resolves
 * `/var` -> `/private/var`; a non-canonical key silently misses and the
 * trust prompt still shows.
 */
export function canonicalPath(p: string): string {
    try {
        return fs.realpathSync(p);
    } catch {
        return path.resolve(p);
    }
}

/** The scrollback grows monotonically across turns, so the new content is everything after the previous snapshot (fall back to the full text). */
export function diffTranscript(full: string, start: string): string {
    const idx = full.indexOf(start);
    return idx >= 0 ? full.slice(idx + start.length) : full;
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Debug switch for verbose harness output: enabled by the suite-wide
 * `AGENT_E2E_DEBUG` or the per-harness var (e.g. `CLAUDE_TUI_HARNESS_DEBUG`).
 */
export function isHarnessDebug(perHarnessEnvVar: string): boolean {
    return !!process.env.AGENT_E2E_DEBUG || !!process.env[perHarnessEnvVar];
}

/** Default timeout for a single `prompt()` turn, shared by all harnesses. */
export const DEFAULT_PROMPT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

const SUPPORTED_TUI_BACKENDS: readonly Backend[] = ["alacritty", "ghostty", "rio"];

/** Validate an env-var backend override (`AGENT_E2E_TUI_BACKEND`) against the supported backends. */
export function resolveBackend(explicit?: Backend): Backend {
    if (explicit) {
        return explicit;
    }
    const fromEnv = process.env.AGENT_E2E_TUI_BACKEND;
    if (fromEnv && (SUPPORTED_TUI_BACKENDS as readonly string[]).includes(fromEnv)) {
        return fromEnv as Backend;
    }
    return "alacritty";
}

/**
 * Normalize an MCP tool name to the bare tool name: agents render tools as
 * `<server>.<tool>` (codex TUI) or `mcp__<server>__<tool>` (claude session
 * JSONL), and claude's transcript collapses to the bare server name
 * (`mongo`). Everything up to the last `.`/`__` is stripped.
 */
export function normalizeToolName(name: string): string {
    const lastSegment = name.split(/__|\./).pop();
    return lastSegment ?? name;
}
