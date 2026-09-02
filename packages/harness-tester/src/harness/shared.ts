import fs from "node:fs";
import path from "node:path";
import type { Backend } from "@microsoft/tui-test";

/**
 * Canonicalize a path so config keys match the agent's view of the filesystem
 * (macOS resolves `/var` -> `/private/var`; a non-canonical key silently misses).
 */
export function canonicalPath(p: string): string {
    try {
        return fs.realpathSync(p);
    } catch {
        return path.resolve(p);
    }
}

/** New content = everything after the previous snapshot (scrollback grows monotonically). */
export function diffTranscript(full: string, start: string): string {
    const idx = full.indexOf(start);
    return idx >= 0 ? full.slice(idx + start.length) : full;
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Debug switch: suite-wide `AGENT_E2E_DEBUG` or the per-harness env var. */
export function isHarnessDebug(perHarnessEnvVar: string): boolean {
    return !!process.env.AGENT_E2E_DEBUG || !!process.env[perHarnessEnvVar];
}

/** Default timeout for a single `prompt()` turn. */
export const DEFAULT_PROMPT_TIMEOUT_MS = 2 * 60 * 1000;

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

/** Strip the `<server>.` / `mcp__<server>__` prefix agents render before tool names. */
export function normalizeToolName(name: string): string {
    const lastSegment = name.split(/__|\./).pop();
    return lastSegment ?? name;
}
