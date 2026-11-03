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

/** Codex may briefly show an idle composer between commentary and a tool call. */
const TURN_COMPLETE_GRACE_MS = 1_000;

/** How many poll snapshots to retain for the on-failure dump (~1 per 500ms). */
const SNAPSHOT_HISTORY_LIMIT = 240;

/** Viewport characters kept per retained snapshot, so the dump stays readable. */
const SNAPSHOT_VIEWPORT_CHARS = 600;

/** Sessions created since the last {@link resetSessionSnapshots}, in creation order. */
const trackedSessions: TuiSessionBase[] = [];

/** Forget previously tracked sessions; call at the start of each test. */
export function resetSessionSnapshots(): void {
    trackedSessions.length = 0;
}

/**
 * Print the poll snapshot history of every session tracked since the last
 * reset. Always visible (not gated on `AGENT_E2E_DEBUG`): call it when a test
 * fails, since the failing run is usually not one debug mode was enabled for.
 */
export function dumpSessionSnapshots(reason: string): void {
    for (const session of trackedSessions) {
        session.dumpSnapshotHistory(reason);
    }
}

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
    /** Recent poll snapshots across all turns, kept so a failure can be diagnosed without `AGENT_E2E_DEBUG`. */
    private readonly snapshotHistory: string[] = [];

    get state(): AgentTurnState {
        return this.currentState;
    }

    protected constructor({
        terminal,
        options,
        onState,
    }: {
        terminal: TuiTest;
        options: AgentHarnessOptions;
        onState?: (state: TuiState) => void;
    }) {
        this.terminal = terminal;
        this.options = options;
        this.onState = onState ?? ((state): void => this.printState(state));
        trackedSessions.push(this);
    }

    /** Record one poll snapshot, evicting the oldest past {@link SNAPSHOT_HISTORY_LIMIT}. */
    private recordSnapshot(state: TuiState): void {
        const viewport = state.viewport.slice(-SNAPSHOT_VIEWPORT_CHARS);
        this.snapshotHistory.push(
            `t=${(state.elapsedMs / 1000).toFixed(1)}s working=${state.working} idle=${state.composerIdle}\n${viewport}`
        );
        if (this.snapshotHistory.length > SNAPSHOT_HISTORY_LIMIT) {
            this.snapshotHistory.shift();
        }
    }

    /**
     * Print the retained snapshots. Unlike the per-poll debug stream this is
     * always visible: a failed test (assertion, harness abort, or vitest's own
     * timeout) is undiagnosable without the state history.
     */
    dumpSnapshotHistory(reason: string): void {
        if (this.snapshotHistory.length === 0) {
            return;
        }
        this.log.info(
            `${reason}; last ${this.snapshotHistory.length} poll snapshot(s) follow` +
                ` (set AGENT_E2E_DEBUG=1 for the full transcript stream):\n` +
                this.snapshotHistory.join("\n---\n")
        );
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
     * Answer a pending elicitation (`confirm`/`decline`) and run the turn to
     * completion, returning the completed {@link AgentTurn}.
     */
    async chooseOption(choice: "confirm" | "decline"): Promise<AgentTurn> {
        if (this.currentState !== "elicitation") {
            throw new Error(`${this.label} TUI has no pending elicitation`);
        }
        await this.sendChoice(choice);
        return this.pollTurn(false);
    }

    /**
     * Submit `choice` in the confirmation prompt currently on screen. Each agent
     * renders it with different labels/controls, so subclasses implement this.
     */
    protected abstract sendChoice(choice: "confirm" | "decline"): Promise<void>;

    /** Codex interposes its own tool-approval prompt before the server's elicitation. */
    protected isToolApproval(text: string): boolean {
        return /Allow the .* MCP server to run tool/.test(text);
    }

    /**
     * Whether the viewport shows a transient banner (startup, reconnect, ...)
     * that renders as "neither working nor idle" but is not real input. Such
     * states must not be mistaken for an elicitation. Harnesses opt in.
     */
    protected isTransitional?(text: string): boolean;

    /**
     * Whether the viewport is a confirmation prompt the agent is waiting on.
     * The default is permissive: any frame that is neither working nor idle
     * counts. Harnesses whose transient frames look the same (e.g. codex's
     * just-submitted prompt) override this with a positive marker so such a
     * frame is not reported as an elicitation before the turn has begun.
     */
    protected isElicitation(text: string): boolean {
        return !this.isWorking(text) && !this.isComposerIdle(text);
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
        // Keep history across turns (an assertion may fail on any of them) but mark the boundary.
        this.snapshotHistory.push(`=== new turn (${stopOnElicitation ? "prompt" : "chooseOption"}) ===`);
        let lastError = "";
        // A turn is only "real" once we have observed it begin: the working
        // marker or the composer leaving its idle placeholder. Without this the
        // first poll after Enter (before the agent has rendered anything)
        // satisfies `!working && composerIdle` and returns a bogus empty turn.
        // Transcript growth is deliberately not a signal: the prompt echo lands
        // in the transcript before the agent starts, so it would arm the guard
        // during the same pre-turn idle window.
        // A choice continues an already-active turn, even if it completes before the first poll.
        let sawTurnActivity = !stopOnElicitation;
        let confirmationPendingSinceMs: number | undefined;
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
            this.recordSnapshot(state);

            // A transitional banner ("Waiting for startup", ...) also renders as
            // "not idle", but it is pre-turn chrome rather than the turn beginning:
            // counting it would mark the turn active before the agent has started,
            // so the next poll (idle composer, agent still booting) would return a
            // bogus completed turn.
            const transitional = this.isTransitional?.(viewport) ?? false;
            if (state.working || (!state.composerIdle && !transitional)) {
                sawTurnActivity = true;
            }

            // Agent is awaiting input when not working and not idle; require that
            // state to persist a couple of polls so we do not fire mid-transition.
            // The positive `isElicitation` marker keeps a transient frame that only
            // looks like input (e.g. codex's just-submitted prompt) from firing.
            const awaitingInput = this.isElicitation(viewport) || this.isToolApproval(viewport);
            if (sawTurnActivity && !state.working && !state.composerIdle && awaitingInput) {
                if (transitional) {
                    confirmationPendingSinceMs = undefined;
                } else {
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
                            // A real turn can call tools before eliciting, so keep what the
                            // delta already shows instead of discarding observed calls.
                            return {
                                text: delta,
                                toolCalls: this.extractToolCalls(delta),
                                state: "elicitation",
                                confirmation: viewport,
                            };
                        }
                    }
                }
            } else {
                confirmationPendingSinceMs = undefined;
            }

            if (!state.working && state.composerIdle && !transitional) {
                idleSinceMs ??= state.elapsedMs;
                const idleDurationMs = state.elapsedMs - idleSinceMs;
                if (
                    (sawTurnActivity && idleDurationMs >= TURN_COMPLETE_GRACE_MS) ||
                    idleDurationMs >= IDLE_BAIL_GRACE_MS
                ) {
                    this.log.debug(`<<turn complete after ${state.elapsedMs}ms>>`);
                    this.onState({
                        ...state,
                        viewport: `turn complete after ${state.elapsedMs}ms\n` + delta.slice(-1200),
                    });
                    return await this.buildTurn(startText);
                }
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
            toolCalls: this.extractToolCalls(delta),
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
