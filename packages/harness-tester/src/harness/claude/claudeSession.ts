import type { TuiTest } from "@microsoft/tui-test";
import { parseClaudeTurn } from "./parseClaudeToolCalls.js";
import { TuiSessionBase, type TuiState } from "../tuiSession.js";
import type { AgentHarnessOptions, ToolCallRecord } from "../types.js";

export type ClaudeState = TuiState;

/** Composer idle marker. */
const COMPOSER_IDLE_MARKER = "❯";
/** Footer marker present only while a turn is in progress. */
const WORKING_FOOTER_MARKER = "esc to interrupt";

export class ClaudeTuiSession extends TuiSessionBase {
    private readonly claudeHome: string;
    private readonly seenCallKeys = new Set<string>();

    constructor(
        terminal: TuiTest,
        options: AgentHarnessOptions,
        claudeHome: string,
        onState?: (state: TuiState) => void
    ) {
        super(terminal, options, onState);
        this.claudeHome = claudeHome;
    }

    protected get label(): string {
        return "claude";
    }

    protected isWorking(text: string): boolean {
        // The `esc to interrupt` footer is only a working signal at the bottom of the
        // viewport; matching it anywhere could match a stale or incidental occurrence.
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        const footer = lines[lines.length - 1] ?? "";
        return footer.includes(WORKING_FOOTER_MARKER);
    }

    protected isComposerIdle(text: string): boolean {
        // A bare `❯` line is the empty composer. `❯ <prompt>` (an echoed prompt) also
        // contains `❯`, so a substring match would report idle too early — that prompt
        // echo is exactly the case that must NOT count as composition idle.
        return text.split("\n").some((l) => l.trim() === COMPOSER_IDLE_MARKER);
    }

    protected extractToolCalls(): ToolCallRecord[] {
        // The session JSONL is the authoritative source; the TUI scrollback only renders the
        // server name, so tool-level calls are read from the JSONL rather than the transcript.
        return parseClaudeTurn({ claudeHomeDir: this.claudeHome, seenCallKeys: this.seenCallKeys }).toolCalls;
    }
}
