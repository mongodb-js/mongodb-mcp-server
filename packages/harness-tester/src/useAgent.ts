import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { DEFAULT_PROMPT_TIMEOUT_MS } from "./harness/shared.js";
import type { AgentHarness, AgentHarnessOptions } from "./harness/types.js";

export interface AgentContext {
    harness: AgentHarness;
    workDir: () => string;
    /** Cached availability probe; the skip gate doesn't re-probe per test. */
    isHarnessAvailable: () => boolean;
    buildOptions: (overrides?: Partial<AgentHarnessOptions>) => AgentHarnessOptions;
}

/**
 * Agent e2e suite setup: temp workdir, availability skip gate, and base
 * session options. Call inside a `describe` block with the harness to drive.
 */
export function useAgent({ harness }: { harness: AgentHarness }): AgentContext {
    let workDir = "";

    let harnessAvailable: boolean | undefined;
    const isHarnessAvailable = (): boolean => (harnessAvailable ??= harness.isAvailable());

    beforeAll(async () => {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-tests-"));
    });

    beforeEach((ctx) => {
        if (!isHarnessAvailable()) {
            ctx.skip(`harness '${harness.name}' not available; agent e2e suite skipped`);
        }
    });

    afterAll(async () => {
        if (workDir) {
            await fs.rm(workDir, { recursive: true, force: true });
        }
    });

    return {
        harness,
        workDir: () => workDir,
        isHarnessAvailable,
        buildOptions: (overrides = {}) => ({
            workDir,
            // Model: per-harness env var > shared AGENT_E2E_MODEL > harness default.
            ...((): { model?: string } => {
                const model =
                    (harness.name === "codex-tui" && process.env.AGENT_E2E_CODEX_MODEL) ||
                    (harness.name === "claude-tui" && process.env.AGENT_E2E_CLAUDE_MODEL) ||
                    process.env.AGENT_E2E_MODEL;
                return model ? { model } : {};
            })(),
            promptTimeoutMs: DEFAULT_PROMPT_TIMEOUT_MS,
            // AGENT_E2E_DEBUG: per-session debug dumps across the suite.
            debug: !!process.env.AGENT_E2E_DEBUG,
            ...overrides,
        }),
    } satisfies AgentContext;
}
