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

/** Composer idle marker. */
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
    /** JSONL tool-call keys already attributed to earlier turns (per-session dedupe). */
    private readonly seenCallKeys = new Set<string>();

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
        // Enter after a short settle: claude drops a same-tick Enter, leaving the prompt in the composer.
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

            // Turn done when the `esc to interrupt` footer is gone and the composer is idle.
            if (!state.working && state.composerIdle) {
                if (isHarnessDebug("CLAUDE_TUI_HARNESS_DEBUG")) {
                    console.log(`[claude-tui][out] <<turn complete after ${state.elapsedMs}ms>>`);
                }
                this.onState({ ...state, viewport: `turn complete after ${state.elapsedMs}ms\n` + delta.slice(-1200) });
                return await this.buildTurn(startText);
            }

            // Debug: stream the transcript as it grows.
            if (isHarnessDebug("CLAUDE_TUI_HARNESS_DEBUG") && delta.length > (this.lastShownDeltaLength ?? 0)) {
                const chunk = delta.slice(this.lastShownDeltaLength ?? 0);
                console.log(`[claude-tui][out] ${chunk}`);
                this.lastShownDeltaLength = delta.length;
            }

            // Session exited (e.g. the TUI crashed).
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
        // Fail loudly with the raw transcript attached for diagnosis.
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
        // Append the viewport: the final reply may still be live, not in the scrollback.
        const viewport = await this.viewportText();
        if (viewport && !delta.includes(viewport.replace(/\s+$/, ""))) {
            delta = delta + "\n" + viewport;
        }
        const parsed = parseClaudeTurn({
            transcript: delta,
            claudeHomeDir: this.claudeHome,
            seenCallKeys: this.seenCallKeys,
        });
        return {
            text: delta,
            toolCalls: parsed.toolCalls,
        };
    }

    async dispose(): Promise<void> {
        await this.terminal.closeQuiet();
    }
}
