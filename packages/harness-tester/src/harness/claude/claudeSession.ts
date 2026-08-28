import type { TuiTest } from "@microsoft/tui-test";
import { parseClaudeTurn } from "./parseClaudeTranscript.js";
import { DEFAULT_PROMPT_TIMEOUT_MS, diffTranscript, isHarnessDebug, sleep } from "../shared.js";
import type { AgentHarnessOptions, AgentSession, AgentTurn } from "../types.js";

export interface ClaudeState {
    /** True while a turn's footer shows `esc to interrupt` (in-progress). */
    working: boolean;
    /** True once the composer shows its idle `❯` line. */
    composerIdle: boolean;
    /** Full live viewport text (or the transcript when the viewport is gone). */
    viewport: string;
    /** Unix ms since the poll loop started (first poll after Enter). */
    elapsedMs: number;
}

/** Delay between typing a prompt and pressing Enter (claude drops a same-tick Enter). */
const TYPE_TO_ENTER_DELAY_MS = 800;

/** The composer idle marker: claude's prompt line is exactly this. */
const COMPOSER_IDLE_MARKER = "❯";
/** Footer marker present only while a turn is in progress. */
const WORKING_FOOTER_MARKER = "esc to interrupt";

export class ClaudeTuiSession implements AgentSession {
    private readonly terminal: TuiTest;
    private readonly options: AgentHarnessOptions;
    /** Hermetic CLAUDE_CONFIG_DIR; source of the session JSONL for exact tool calls. */
    private readonly claudeHome: string;
    /** Per-poll state callback (default: env-gated debug print). */
    private readonly onState: (state: ClaudeState) => void;
    /** Length of the turn delta already streamed to stdout (debug streaming). */
    private lastShownDeltaLength: number | undefined;

    constructor(
        terminal: TuiTest,
        options: AgentHarnessOptions,
        claudeHome: string,
        onState?: (state: ClaudeState) => void
    ) {
        this.terminal = terminal;
        this.options = options;
        this.claudeHome = claudeHome;
        this.onState =
            onState ??
            ((state): void => {
                if (isHarnessDebug("CLAUDE_TUI_HARNESS_DEBUG")) {
                    const tail = state.viewport
                        .split("\n")
                        .filter((l) => l.trim())
                        .slice(-7);
                    console.log(
                        `[claude-tui][state] t=${Math.round(state.elapsedMs / 1000)}s working=${state.working} idle=${state.composerIdle}`
                    );
                    console.log(`[claude-tui][state] viewport tail:\n${tail.join("\n")}`);
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
        // after a short settle: claude drops the keypress when Enter arrives
        // immediately after the typed text, leaving the prompt stuck in the
        // composer and the turn never starting.
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

            const state: ClaudeState = {
                working: this.isWorking(viewport),
                composerIdle: this.isComposerIdle(viewport),
                viewport,
                elapsedMs: Date.now() - startedAt,
            };
            this.onState(state);

            // The turn is done when claude stops *working*: the footer's
            // `esc to interrupt` is gone and the composer has returned to its
            // idle `❯` line.
            if (!state.working && state.composerIdle) {
                if (isHarnessDebug("CLAUDE_TUI_HARNESS_DEBUG")) {
                    console.log(`[claude-tui][out] <<turn complete after ${state.elapsedMs}ms>>`);
                }
                this.onState({ ...state, viewport: `turn complete after ${state.elapsedMs}ms\n` + delta.slice(-1200) });
                return await this.buildTurn(startText);
            }

            // Stream the full transcript as it grows so a debug run shows
            // everything claude prints, not just the composer/status lines.
            if (isHarnessDebug("CLAUDE_TUI_HARNESS_DEBUG") && delta.length > (this.lastShownDeltaLength ?? 0)) {
                const chunk = delta.slice(this.lastShownDeltaLength ?? 0);
                console.log(`[claude-tui][out] ${chunk}`);
                this.lastShownDeltaLength = delta.length;
            }

            // Failure signals: the composer did not return and the session
            // exited (e.g. the TUI crashed).
            const exitCode = await this.terminal.getExitCode().catch(() => null);
            if (exitCode !== null) {
                lastError = `claude TUI exited with code ${exitCode}`;
                break;
            }
            lastError = "";
            await sleep(2000);
        }

        const text = await this.transcriptText();
        const delta = diffTranscript(text, startText);
        const message = lastError || `claude TUI turn timed out after ${timeoutMs}ms`;
        if (isHarnessDebug("CLAUDE_TUI_HARNESS_DEBUG")) {
            console.log(`[claude-tui][out] <<aborting: ${message}>>\n${delta}`);
        }
        // Surface the failure as a missing reply so the test assertion fails
        // loudly with the raw terminal content attached for diagnosis.
        return {
            text: `ERROR: ${message}${text ? "\n\n--- terminal content ---\n" + text : ""}`,
            toolCalls: [],
        };
    }

    /** Whether the composer has returned to its idle prompt (turn finished). */
    private isComposerIdle(text: string): boolean {
        const lines = text.split("\n").map((l) => l.trimEnd());
        return lines.some((l) => l.trim() === COMPOSER_IDLE_MARKER);
    }

    /** Whether the footer shows an in-progress turn. */
    private isWorking(text: string): boolean {
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        const footer = lines[lines.length - 1] ?? "";
        return footer.includes(WORKING_FOOTER_MARKER);
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
        throw new Error(`claude TUI composer did not become idle within ${timeoutMs}ms:\n${text.slice(-2000)}`);
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
        // The final reply (and the composer idle line) may still be in the live
        // viewport rather than the scrollback when the turn completes; append
        // the viewport so the parser sees the full turn content.
        const viewport = await this.viewportText();
        if (viewport && !delta.includes(viewport.replace(/\s+$/, ""))) {
            delta = delta + "\n" + viewport;
        }
        const parsed = parseClaudeTurn({ transcript: delta, claudeHomeDir: this.claudeHome });
        return {
            text: delta,
            toolCalls: parsed.toolCalls,
        };
    }

    async dispose(): Promise<void> {
        await this.terminal.closeQuiet();
    }
}
