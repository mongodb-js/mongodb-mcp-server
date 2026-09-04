import type { TuiTest } from "@microsoft/tui-test";
import { DEFAULT_PROMPT_TIMEOUT_MS, diffTranscript, sleep } from "./shared.js";
import { HarnessLogger } from "./logger.js";
import type { AgentHarnessOptions, AgentSession, AgentTurn, PromptOptions, ToolCallRecord } from "./types.js";

/** Delay between typing a prompt and pressing Enter (agents drop a same-tick Enter). */
const TYPE_TO_ENTER_DELAY_MS = 800;

/** How long an idle+not-working composer may persist before we accept a turn as complete
 * even without observing the turn start (guard against pathological no-activity hangs). */
const IDLE_BAIL_GRACE_MS = 30_000;

/** How long the not-working+not-idle state must persist before we treat it as an awaited confirmation. */
const CONFIRMATION_PENDING_GRACE_MS = 6_000;

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
     * Select an option in a confirmation prompt (e.g. an MCP elicitation). The
     * prompt is a multiple-choice list rendering either as a numbered list with
     * "enter to submit" (codex) or as a clickable Accept/Decline form (claude),
     * so we locate the option by label and pick the right interaction.
     * Subclasses may override for agent-specific menus.
     */
    async chooseOption(option: string): Promise<void> {
        const text = await this.terminal.text({ full: true });
        const lines = text.split("\n");
        // Locate the option: prefer the given label, else fall back to a decline
        // keyword so one response works across agent renderings (codex's
        // "No, I do not confirm" vs claude's "Decline").
        const declineRe = /No, I do not confirm|Decline/i;
        const target =
            lines.find((l) => l.toLowerCase().includes(option.toLowerCase())) ?? lines.find((l) => declineRe.test(l));
        const numbered = target?.match(/^\s*[›❯]?\s*(\d+)\.\s+(.+)$/);
        if (numbered) {
            // Cursor starts on option 1, so move (target - 1) rows down, then submit.
            for (let i = 1; i < Number(numbered[1]); i++) {
                await this.terminal.keyboard.press("ArrowDown");
            }
            await this.terminal.keyboard.press("Enter");
            return;
        }
        // Clickable form (claude): click the decline option, then submit.
        const clickText = target?.match(/(No, I do not confirm|Decline)/)?.[0] ?? option;
        await this.terminal.mouse.click(null, null, { onText: clickText });
        await this.terminal.keyboard.press("Enter");
    }

    /**
     * Heuristic for an agent-native tool-permission prompt (e.g. codex's
     * "Allow the ... MCP server to run tool") that precedes the server's
     * elicitation. Approve it so the call reaches the server.
     */
    protected isToolApproval(text: string): boolean {
        return /Allow the .* MCP server to run tool/.test(text);
    }

    /** Submit the default choice of a tool-permission prompt (codex's "1. Allow"). */
    protected async approveTool(): Promise<void> {
        await this.terminal.keyboard.press("Enter");
    }

    async prompt(prompt: string, options?: PromptOptions): Promise<AgentTurn> {
        const startText = await this.transcriptText();
        // Enter after a short settle: agents drop a same-tick Enter, leaving the prompt in the composer.
        await this.terminal.type(prompt);
        await sleep(TYPE_TO_ENTER_DELAY_MS);
        await this.terminal.keyboard.press("Enter");

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
        let handledConfirmationAtLength = 0;
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

            // Answer a mid-turn confirmation (e.g. an MCP elicitation prompt) or
            // auto-approve an agent tool-permission prompt. The agent is waiting at
            // a choice when it is no longer working but the composer is not idle;
            // require that state to persist a couple of polls so we do not fire
            // during the working→idle transition.
            const onConfirmation = options?.onConfirmation;
            if (
                onConfirmation &&
                sawTurnActivity &&
                !state.working &&
                !state.composerIdle &&
                delta.length > handledConfirmationAtLength
            ) {
                confirmationPendingSinceMs ??= state.elapsedMs;
                if (state.elapsedMs - confirmationPendingSinceMs >= CONFIRMATION_PENDING_GRACE_MS) {
                    if (this.isToolApproval(viewport)) {
                        // Agent-native tool approval (e.g. codex) precedes the MCP
                        // elicitation; approve it so the call reaches the server.
                        this.log.debug(`${this.label} approving tool call`);
                        await this.approveTool();
                        confirmationPendingSinceMs = undefined;
                        continue;
                    }
                    this.log.debug(`${this.label} awaiting confirmation; selecting the chosen option`);
                    const option = await onConfirmation({ text: viewport });
                    await this.chooseOption(option);
                    handledConfirmationAtLength = delta.length;
                    confirmationPendingSinceMs = undefined;
                    continue;
                }
            } else {
                confirmationPendingSinceMs = undefined;
            }

            // Turn done when the in-progress marker is gone and the composer is idle.
            if (!state.working && state.composerIdle) {
                // Require evidence the turn actually started so we don't return an empty
                // turn on the first poll before the agent renders anything. Bail out if
                // the composer stays idle+not-working with no activity for too long.
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
