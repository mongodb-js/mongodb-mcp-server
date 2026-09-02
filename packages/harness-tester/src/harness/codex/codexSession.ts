import type { TuiTest } from "@microsoft/tui-test";
import { parseTuiTranscript } from "./codexParseTuiTranscript.js";
import { DEFAULT_PROMPT_TIMEOUT_MS, diffTranscript, isHarnessDebug, sleep } from "../shared.js";
import type { AgentHarnessOptions, AgentSession, AgentTurn } from "../types.js";

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

/** Delay between typing a prompt and pressing Enter (codex drops a same-tick Enter). */
const TYPE_TO_ENTER_DELAY_MS = 800;

/** Composer idle marker (turn finished). */
const COMPOSER_IDLE_MARKER = "Ask Codex to do anything";

export class CodexTuiSession implements AgentSession {
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
                if (isHarnessDebug("CODEX_TUI_HARNESS_DEBUG")) {
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
        // Enter after a short settle: codex drops a same-tick Enter, leaving the prompt in the composer.
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

            // Turn done when the `Working` status is gone and the composer is idle
            // (scrollback idle text lingers, so it is not a reliable signal).
            if (!state.working && state.composerIdle) {
                if (isHarnessDebug("CODEX_TUI_HARNESS_DEBUG")) {
                    console.log(`[codex-tui][out] <<turn complete after ${state.elapsedMs}ms>>`);
                }
                this.onState({ ...state, viewport: `turn complete after ${state.elapsedMs}ms\n` + delta.slice(-1200) });
                return await this.buildTurn(startText);
            }

            // Debug: stream the transcript as it grows.
            if (isHarnessDebug("CODEX_TUI_HARNESS_DEBUG") && delta.length > (this.lastShownDeltaLength ?? 0)) {
                const chunk = delta.slice(this.lastShownDeltaLength ?? 0);
                console.log(`[codex-tui][out] ${chunk}`);
                this.lastShownDeltaLength = delta.length;
            }

            // Session exited (e.g. the TUI crashed).
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
        if (isHarnessDebug("CODEX_TUI_HARNESS_DEBUG")) {
            console.log(`[codex-tui][out] <<aborting: ${message}>>\n${delta}`);
        }
        // Fail loudly with the raw transcript attached for diagnosis.
        return {
            text: `ERROR: ${message}${text ? "\n\n--- terminal content ---\n" + text : ""}`,
            toolCalls: [],
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

    /** Live (viewport-only) terminal text. */
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

    private async buildTurn(startText: string): Promise<AgentTurn> {
        const full = await this.transcriptText();
        let delta = diffTranscript(full, startText);
        // Append the viewport: the final reply may still be live, not in the scrollback.
        const viewport = await this.viewportText();
        if (viewport && !delta.includes(viewport.replace(/\s+$/, ""))) {
            delta = delta + "\n" + viewport;
        }
        const parsed = parseTuiTranscript(delta);
        return {
            text: delta,
            toolCalls: parsed.toolCalls,
        };
    }

    async dispose(): Promise<void> {
        await this.terminal.closeQuiet();
    }
}
