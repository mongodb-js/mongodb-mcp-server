import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { TuiTest, type Backend } from "@microsoft/tui-test";
import { CodexHarnessConfig } from "./codexConfig.js";
import { parseTuiTranscript } from "./codexParseTuiTranscript.js";
import { diffTranscript, resolveBackend, sleep } from "../shared.js";
import type { AgentHarness, AgentHarnessOptions, AgentSession, AgentTurn } from "../types.js";

export interface CodexState {
    /** True while a turn's `Working (Ns • esc to interrupt)` status is live. */
    working: boolean;
    /** True once the composer shows its idle `Ask Codex to do anything` line. */
    composerIdle: boolean;
    /** Full live viewport text (or the transcript when the viewport is gone). */
    viewport: string;
    /** Unix ms since the poll loop started (first poll after Enter). */
    elapsedMs: number;
}

export interface CodexTuiHarnessOptions {
    /** Override the codex binary path (default: "codex" on PATH). */
    binaryPath?: string;
    /** tui-test emulator backend (default: "alacritty", override for CI). */
    backend?: Backend;
    /** Terminal size in cells (default: 180x50). */
    cols?: number;
    rows?: number;
    /** Per-poll state callback for tests that want to observe/live-debug the TUI. */
    onState?: (state: CodexState) => void;
}

const DEFAULT_PROMPT_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
/** Delay between typing a prompt and pressing Enter (codex drops a same-tick Enter). */
const TYPE_TO_ENTER_DELAY_MS = 800;

/** Terminal string shown by codex when the composer is idle (turn finished). */
const COMPOSER_IDLE_MARKER = "Ask Codex to do anything";

export class CodexTuiHarness implements AgentHarness {
    readonly name = "codex-tui";

    private readonly binaryPath: string | undefined;
    private readonly backend: Backend;
    private readonly cols: number;
    private readonly rows: number;
    private readonly onState: ((state: CodexState) => void) | undefined;

    constructor(options: CodexTuiHarnessOptions = {}) {
        this.binaryPath = options.binaryPath;
        this.backend = resolveBackend(options.backend);
        this.cols = options.cols ?? 180;
        this.rows = options.rows ?? 50;
        this.onState = options.onState;
    }

    getBinaryPath(): string {
        return this.binaryPath ?? process.env.AGENT_E2E_CODEX_BIN ?? "codex";
    }

    getBackend(): Backend {
        return this.backend;
    }

    /**
     * Synchronous (required by `describe.skipIf`): binary runs `--version`,
     * and auth counts as available when GROVE_API_KEY is set (the grove
     * provider reads the key through `env_key = "GROVE_API_KEY"`).
     */
    isAvailable(): boolean {
        const binary = this.getBinaryPath();
        try {
            execFileSync(binary, ["--version"], { timeout: 30_000, stdio: "ignore" });
        } catch {
            console.log(`[codex-tui] binary '${binary}' not available; skipping agent e2e tests`);
            return false;
        }
        if (process.env.GROVE_API_KEY) {
            return true;
        }
        console.log("[codex-tui] no GROVE_API_KEY set; skipping agent e2e tests");
        return false;
    }

    async start(options: AgentHarnessOptions): Promise<AgentSession> {
        // Per-session CODEX_HOME so the developer's config is untouched.
        const config = new CodexHarnessConfig();
        const codexHome = path.join(options.workDir, "codex-home");
        await fs.mkdir(codexHome, { recursive: true });
        const configToml = config.buildConfig(options, codexHome);
        await fs.writeFile(path.join(codexHome, config.configFileName), configToml);

        if (options.debug) {
            // Redact bearer tokens so debug dumps never leak provider keys.
            console.log(`[codex-tui] ${config.configFileName}:\n${config.redactSecrets(configToml)}`);
        }

        const terminal = new TuiTest(`codex-${process.pid}-${Math.random().toString(36).slice(2, 8)}`, {
            backend: this.backend,
            timeouts: { ready: 60_000, text: 60_000, idle: 60_000 },
        });
        await terminal.run(this.getBinaryPath(), [], {
            cwd: options.workDir,
            cols: this.cols,
            rows: this.rows,
            env: {
                ...process.env,
                CODEX_HOME: codexHome,
                TERM: "xterm-256color",
            },
            waitReady: false,
        });

        const session = new CodexTuiSession(terminal, options, this.onState);
        await session.initialise();
        return session;
    }
}

class CodexTuiSession implements AgentSession {
    private readonly terminal: TuiTest;
    private readonly options: AgentHarnessOptions;
    /** Per-poll state callback (default: env-gated debug print). */
    private readonly onState: (state: CodexState) => void;
    /** Length of the turn delta already streamed to stdout (debug streaming). */
    private lastShownDeltaLength: number | undefined;

    constructor(terminal: TuiTest, options: AgentHarnessOptions, onState?: (state: CodexState) => void) {
        this.terminal = terminal;
        this.options = options;
        this.onState =
            onState ??
            ((state): void => {
                if (process.env.CODEX_TUI_HARNESS_DEBUG) {
                    const tail = state.viewport.split("\n").slice(-7);
                    console.log(
                        `[codex-tui][state] t=${Math.round(state.elapsedMs / 1000)}s working=${state.working} idle=${state.composerIdle}`
                    );
                    console.log(`[codex-tui][state] viewport tail:\n${tail.join("\n")}`);
                }
            });
    }

    /** Wait until the composer is ready for a prompt. */
    async initialise(): Promise<void> {
        await this.waitIdleComposer(30_000);
    }

    async prompt(prompt: string): Promise<AgentTurn> {
        const startText = await this.transcriptText();
        // Submit the prompt into the composer. The Enter must be sent only
        // after a short settle: codex drops the keypress when Enter arrives
        // immediately after the typed text (verified empirically), leaving the
        // prompt stuck in the composer and the turn never starting.
        await this.terminal.type(prompt);
        await sleep(TYPE_TO_ENTER_DELAY_MS);
        await this.terminal.keyboard.press("Enter");

        const timeoutMs = this.options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
        const deadline = Date.now() + timeoutMs;
        const startedAt = Date.now();
        let lastError = "";

        while (Date.now() < deadline) {
            const full = await this.transcriptText();
            const delta = diffTranscript(full, startText);
            const viewport = await this.viewportText();

            const state: CodexState = {
                working: this.isWorking(viewport),
                composerIdle: this.isComposerIdle(viewport),
                viewport,
                elapsedMs: Date.now() - startedAt,
            };
            this.onState(state);

            // The turn is done when codex stops *working*: the transient
            // `Working (Ns • esc to interrupt)` status in the live viewport is
            // gone and the composer has returned to its idle prompt. The
            // scrollback is not a reliable signal — the idle text lingers in
            // it from earlier frames.
            if (!state.working && state.composerIdle) {
                if (process.env.CODEX_TUI_HARNESS_DEBUG) {
                    console.log(`[codex-tui][out] <<turn complete after ${state.elapsedMs}ms>>`);
                }
                this.onState({ ...state, viewport: `turn complete after ${state.elapsedMs}ms\n` + delta.slice(-1200) });
                return await this.buildTurn(startText);
            }

            // Stream the full transcript as it grows so a debug run shows
            // everything codex prints, not just the composer/status lines.
            if (process.env.CODEX_TUI_HARNESS_DEBUG && delta.length > (this.lastShownDeltaLength ?? 0)) {
                const chunk = delta.slice(this.lastShownDeltaLength ?? 0);
                console.log(`[codex-tui][out] ${chunk}`);
                this.lastShownDeltaLength = delta.length;
            }

            // Failure signals: the composer did not return and the session
            // exited (e.g. the TUI crashed).
            const exitCode = await this.terminal.getExitCode().catch(() => null);
            if (exitCode !== null) {
                lastError = `codex TUI exited with code ${exitCode}`;
                break;
            }
            lastError = "";
            await sleep(2000);
        }

        const text = await this.transcriptText();
        const delta = diffTranscript(text, startText);
        const message = lastError || `codex TUI turn timed out after ${timeoutMs}ms`;
        if (process.env.CODEX_TUI_HARNESS_DEBUG) {
            console.log(`[codex-tui][out] <<aborting: ${message}>>\n${delta}`);
        }
        // Surface the failure as a missing reply so the test assertion fails
        // loudly with the raw transcript attached for diagnosis.
        return {
            text: `ERROR: ${message}`,
            toolCalls: [],
            transcript: text,
        };
    }

    /** Whether the composer has returned to its idle prompt (turn finished). */
    private isComposerIdle(text: string): boolean {
        return text.includes(COMPOSER_IDLE_MARKER);
    }

    /** Whether the codex status line shows an in-progress turn. */
    private isWorking(text: string): boolean {
        return /Working \(\d+s • esc to interrupt\)/.test(text);
    }

    /** Live (viewport-only) terminal text; the composer line is the last line. */
    private async viewportText(): Promise<string> {
        try {
            return await this.terminal.text({ full: false });
        } catch {
            return "";
        }
    }

    private async waitIdleComposer(timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        let text = "";
        while (Date.now() < deadline) {
            text = await this.viewportText();
            if (!this.isWorking(text) && this.isComposerIdle(text)) {
                return;
            }
            await sleep(1000);
        }
        throw new Error(`codex TUI composer did not become idle within ${timeoutMs}ms:\n${text.slice(-2000)}`);
    }

    /** Full terminal scrollback text (best-effort; errors tolerated). */
    private async transcriptText(): Promise<string> {
        try {
            return await this.terminal.text({ full: true });
        } catch {
            return "";
        }
    }

    /** Parse the portion of the transcript written after `startText`. */
    private async buildTurn(startText: string): Promise<AgentTurn> {
        const full = await this.transcriptText();
        let delta = diffTranscript(full, startText);
        // The final reply (and the composer idle line) may still be in the live
        // viewport rather than the scrollback when the turn completes; append
        // the viewport so the parser sees the full turn content.
        const viewport = await this.viewportText();
        if (viewport && !delta.includes(viewport.replace(/\s+$/, ""))) {
            delta = delta + "\n" + viewport;
        }
        const parsed = parseTuiTranscript(delta);
        return {
            text: parsed.replyText,
            toolCalls: parsed.toolCalls,
            transcript: delta,
        };
    }

    async dispose(): Promise<void> {
        await this.terminal.closeQuiet();
    }
}
