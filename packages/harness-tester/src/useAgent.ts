import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";
import type { AgentHarness, AgentHarnessOptions } from "./harness/types.js";

export interface AgentContext {
    harness: AgentHarness;
    workDir: () => string;
    /** Cached `harness --version` + auth probe; the skip gate doesn't re-probe per test. */
    isHarnessAvailable: () => boolean;
    /** Produce a full AgentHarnessOptions for the harness session. */
    buildOptions: (overrides?: Partial<AgentHarnessOptions>) => AgentHarnessOptions;
}

/**
 * Hook-style setup for an agent e2e suite. Call it inside a regular
 * `describe` block with the harness to drive:
 *
 *   describe("setup", () => {
 *     const { harness, buildOptions } = useAgent({ harness: new CodexTuiHarness() });
 *     it("...", async () => { ... });
 *   });
 */
export function useAgent({ harness }: { harness: AgentHarness }): AgentContext {
    let workDir = "";

    // `harness --version` + auth probe is authoritative and stable for the run;
    // cache it so the skip gate doesn't re-probe per test.
    let harnessAvailable: boolean | undefined;
    const isHarnessAvailable = (): boolean => (harnessAvailable ??= harness.isAvailable());

    beforeAll(async () => {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-e2e-"));
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
            // Model resolution: explicit CI override wins; otherwise the
            // config generation inherits the harness's default model.
            // Per-harness env vars (AGENT_E2E_CODEX_MODEL / AGENT_E2E_CLAUDE_MODEL)
            // take precedence over the shared AGENT_E2E_MODEL.
            ...((): { model?: string } => {
                const model =
                    (harness.name === "codex-tui" && process.env.AGENT_E2E_CODEX_MODEL) ||
                    (harness.name === "claude-tui" && process.env.AGENT_E2E_CLAUDE_MODEL) ||
                    process.env.AGENT_E2E_MODEL;
                return model ? { model } : {};
            })(),
            promptTimeoutMs: 10 * 60 * 1000,
            // `AGENT_E2E_DEBUG` turns on per-session debug dumps (config,
            // streams) for the whole suite without touching individual tests.
            debug: !!process.env.AGENT_E2E_DEBUG,
            ...overrides,
        }),
    } satisfies AgentContext;
}
