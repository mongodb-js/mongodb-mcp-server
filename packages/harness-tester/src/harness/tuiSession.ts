import type { TuiTest } from "@microsoft/tui-test";
import { DEFAULT_PROMPT_TIMEOUT_MS, diffTranscript, sleep } from "./shared.js";
import { HarnessLogger } from "./logger.js";
import type { AgentHarnessOptions, AgentSession, AgentTurn, ToolCallRecord } from "./types.js";

/** Delay between typing a prompt and pressing Enter (agents drop a same-tick Enter). */
const TYPE_TO_ENTER_DELAY_MS = 800;

/** Per-poll state shared by both agent TUI sessions. */
export interface TuiState {
    /** True while the session's status/footer shows an in-progress turn. */
    working: boolean;
    /** True once the composer shows its idle line (turn finished). */
    composerIdle: boolean;
    /** Full live viewport text (or the transcript when the viewport is gone). */
    viewport: string;
    /** Unix ms since the poll loop started (first poll after Enter). */
    elapsedMs: number;
}

/**
 * Shared polling loop + terminal helpers for agent TUI sessions. Subclasses
 * supply only the agent-specific bits: the label, the in-progress and idle
 * markers, and how to extract tool calls for a completed turn.
 */
export abstract class TuiSessionBase implements AgentSession {
    protected readonly terminal: TuiTest;
    protected readonly options: AgentHarnessOptions;
    private readonly onState: (state: TuiState) => void;
    private _log: HarnessLogger | undefined;
    /** Length of the turn delta already streamed to stdout (debug streaming). */
    private lastShownDeltaLength: number | undefined;

    protected constructor(terminal: TuiTest, options: AgentHarnessOptions, onState?: (state: TuiState) => void) {
        this.terminal = terminal;
        this.options = options;
        this.onState = onState ?? ((state): void => this.printState(state));
    }

    /** Agent label used in debug/error output (e.g. "codex"). */
    protected abstract get label(): string;
    private get log(): HarnessLogger {
        return (this._log ??= new HarnessLogger(`${this.label}-tui`));
    }
    /** Whether the viewport shows an in-progress turn. */
    protected abstract isWorking(text: string): boolean;
    /** Whether the composer has returned to idle (turn finished). */
    protected abstract isComposerIdle(text: string): boolean;
    /** Extract tool calls for a completed turn's transcript delta. */
    protected abstract extractToolCalls(delta: string): ToolCallRecord[];

    /** Wait until the composer is ready for a prompt. */
    async initialise(): Promise<void> {
        await this.waitIdleComposer(30_000);
    }

    async prompt(prompt: string): Promise<AgentTurn> {
        const startText = await this.transcriptText();
        // Enter after a short settle: agents drop a same-tick Enter, leaving the prompt in the composer.
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

            const state: TuiState = {
                working: this.isWorking(viewport),
                composerIdle: this.isComposerIdle(viewport),
                viewport,
                elapsedMs: Date.now() - startedAt,
            };
            this.onState(state);

            // Turn done when the in-progress marker is gone and the composer is idle.
            if (!state.working && state.composerIdle) {
                this.log.debug(`<<turn complete after ${state.elapsedMs}ms>>`);
                this.onState({ ...state, viewport: `turn complete after ${state.elapsedMs}ms\n` + delta.slice(-1200) });
                return await this.buildTurn(startText);
            }

            // Debug: stream the transcript as it grows.
            if (delta.length > (this.lastShownDeltaLength ?? 0)) {
                const chunk = delta.slice(this.lastShownDeltaLength ?? 0);
                this.log.debug(chunk);
                this.lastShownDeltaLength = delta.length;
            }

            // Session exited (e.g. the TUI crashed).
            const exitCode = await this.terminal.getExitCode().catch(() => null);
            if (exitCode !== null) {
                lastError = `${this.label} TUI exited with code ${exitCode}`;
                break;
            }
            lastError = "";
            await sleep(2000);
        }

        const text = await this.transcriptText();
        const delta = diffTranscript(text, startText);
        const message = lastError || `${this.label} TUI turn timed out after ${timeoutMs}ms`;
        this.log.debug(`<<aborting: ${message}>>\n${delta}`);
        // Fail loudly with the raw transcript attached for diagnosis.
        return {
            text: `ERROR: ${message}${text ? "\n\n--- terminal content ---\n" + text : ""}`,
            toolCalls: [],
        };
    }

    /** Whether the composer has returned to its idle prompt (turn finished). */
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
        throw new Error(`${this.label} TUI composer did not become idle within ${timeoutMs}ms:\n${text.slice(-2000)}`);
    }

    private async viewportText(): Promise<string> {
        return this.terminal.text({ full: false });
    }

    private async transcriptText(): Promise<string> {
        return this.terminal.text({ full: true });
    }

    private async buildTurn(startText: string): Promise<AgentTurn> {
        const full = await this.transcriptText();
        let delta = diffTranscript(full, startText);
        // Append the viewport: the final reply may still be live, not in the scrollback.
        const viewport = await this.viewportText();
        if (viewport && !delta.includes(viewport.replace(/\s+$/, ""))) {
            delta = delta + "\n" + viewport;
        }
        return {
            text: delta,
            toolCalls: this.extractToolCalls(delta),
        };
    }

    private printState(state: TuiState): void {
        const tail = state.viewport
            .split("\n")
            .filter((l) => l.trim())
            .slice(-7);
        this.log.debug(
            `t=${Math.round(state.elapsedMs / 1000)}s working=${state.working} idle=${state.composerIdle}\n` +
                tail.join("\n")
        );
    }

    async dispose(): Promise<void> {
        await this.terminal.closeQuiet();
    }
}
