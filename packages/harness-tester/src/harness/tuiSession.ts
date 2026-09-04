import type { TuiTest } from "@microsoft/tui-test";
import { DEFAULT_PROMPT_TIMEOUT_MS, diffTranscript, sleep } from "./shared.js";
import { HarnessLogger } from "./logger.js";
import type { AgentHarnessOptions, AgentSession, AgentTurn, AgentTurnState, ToolCallRecord } from "./types.js";

/** Delay between typing a prompt and pressing Enter (agents drop a same-tick Enter). */
const TYPE_TO_ENTER_DELAY_MS = 800;

/** How long an idle+not-working composer may persist before we accept a turn as complete
 * even without observing the turn start (guard against pathological no-activity hangs). */
const IDLE_BAIL_GRACE_MS = 30_000;

/** How long the not-working+not-idle state must persist before we treat it as an awaited confirmation. */
const CONFIRMATION_PENDING_GRACE_MS = 1_000;

/** Per-poll state shared by both agent TUI sessions. */
export interface TuiState {
    /** True while the session's status/footer shows an in-progress turn. */
    working: boolean;
    /** True once the composer shows its idle line (turn finished). */
    composerIdle: boolean;
    /** Full live viewport text (or the transcript when the viewport is gone). */
    viewport: string;
    /** ms since the poll loop started (first poll after Enter). */
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
    /** Transcript snapshot the current turn started from (so chooseOption can continue it). */
    private currentTurnStartText = "";
    private currentState: AgentTurnState = "completed";

    get state(): AgentTurnState {
        return this.currentState;
    }

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

    /**
     * Answer a pending elicitation and run the turn to completion, returning the
     * completed {@link AgentTurn}. `option` is the option label to send, e.g.
     * "No, I do not confirm" or "Accept".
     */
    async chooseOption(option: string): Promise<AgentTurn> {
        await this.terminal.type(option);
        await this.terminal.keyboard.press("Enter");
        return this.pollTurn(false);
    }

    /** Codex interposes its own tool-approval prompt before the server's elicitation. */
    protected isToolApproval(text: string): boolean {
        return /Allow the .* MCP server to run tool/.test(text);
    }

    protected async approveTool(): Promise<void> {
        await this.terminal.keyboard.press("Enter");
    }

    async prompt(prompt: string): Promise<AgentTurn> {
        // Enter after a short settle: agents drop a same-tick Enter, leaving the prompt in the composer.
        this.currentTurnStartText = await this.transcriptText();
        await this.terminal.type(prompt);
        await sleep(TYPE_TO_ENTER_DELAY_MS);
        await this.terminal.keyboard.press("Enter");
        return this.pollTurn(true);
    }

    /**
     * Poll until the turn completes or, when `stopOnElicitation`, the agent is
     * awaiting a confirmation (auto-approving codex's tool-permission prompt).
     */
    private async pollTurn(stopOnElicitation: boolean): Promise<AgentTurn> {
        const startText = this.currentTurnStartText;
        const timeoutMs = this.options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
        const deadline = Date.now() + timeoutMs;
        const startedAt = Date.now();
        let lastError = "";
        // A turn is only "real" once we have observed it begin: the working marker,
        // the composer leaving its idle placeholder, or the transcript growing past
        // the prompt echo. Without this the first poll after Enter (before the agent
        // has rendered anything) satisfies `!working && composerIdle` and returns a
        // bogus empty turn.
        let sawTurnActivity = false;
        let confirmationPendingSinceMs: number | undefined;
        let prevDeltaLength: number | undefined;
        let idleSinceMs: number | undefined;

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

            if (
                state.working ||
                !state.composerIdle ||
                (prevDeltaLength !== undefined && delta.length > prevDeltaLength)
            ) {
                sawTurnActivity = true;
            }
            prevDeltaLength = delta.length;

            // Agent is awaiting input when not working and not idle; require that
            // state to persist a couple of polls so we do not fire mid-transition.
            if (sawTurnActivity && !state.working && !state.composerIdle) {
                confirmationPendingSinceMs ??= state.elapsedMs;
                if (state.elapsedMs - confirmationPendingSinceMs >= CONFIRMATION_PENDING_GRACE_MS) {
                    if (this.isToolApproval(viewport)) {
                        await this.approveTool();
                        confirmationPendingSinceMs = undefined;
                        continue;
                    }
                    if (stopOnElicitation) {
                        this.currentState = "elicitation";
                        this.lastShownDeltaLength = delta.length;
                        return { text: delta, toolCalls: [], state: "elicitation", confirmation: viewport };
                    }
                }
            } else {
                confirmationPendingSinceMs = undefined;
            }

            // Turn done when the in-progress marker is gone and the composer is idle.
            if (!state.working && state.composerIdle) {
                if (
                    sawTurnActivity ||
                    (idleSinceMs !== undefined && state.elapsedMs - idleSinceMs >= IDLE_BAIL_GRACE_MS)
                ) {
                    this.log.debug(`<<turn complete after ${state.elapsedMs}ms>>`);
                    this.onState({
                        ...state,
                        viewport: `turn complete after ${state.elapsedMs}ms\n` + delta.slice(-1200),
                    });
                    return await this.buildTurn(startText);
                }
                idleSinceMs ??= state.elapsedMs;
            } else {
                idleSinceMs = undefined;
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
            await sleep(500);
        }

        const text = await this.transcriptText();
        const delta = diffTranscript(text, startText);
        const message = lastError || `${this.label} TUI turn timed out after ${timeoutMs}ms`;
        this.log.debug(`<<aborting: ${message}>>\n${delta}`);
        this.currentState = "completed";
        // Fail loudly with the raw transcript attached for diagnosis.
        return {
            text: `ERROR: ${message}${text ? "\n\n--- terminal content ---\n" + text : ""}`,
            toolCalls: [],
            state: "completed",
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
        this.currentState = "completed";
        return {
            text: delta,
            toolCalls: this.extractToolCalls(delta),
            state: "completed",
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
