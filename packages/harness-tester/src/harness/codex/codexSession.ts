import type { TuiTest } from "@microsoft/tui-test";
import { parseTuiTranscript } from "./codexParseTuiTranscript.js";
import { TuiSessionBase, type TuiState } from "../tuiSession.js";
import type { AgentHarnessOptions, ToolCallRecord } from "../types.js";

export type CodexState = TuiState;

/** Composer idle marker (turn finished). */
const COMPOSER_IDLE_MARKER = "Ask Codex to do anything";

export class CodexTuiSession extends TuiSessionBase {
    constructor(terminal: TuiTest, options: AgentHarnessOptions, onState?: (state: TuiState) => void) {
        super(terminal, options, onState);
    }

    protected get label(): string {
        return "codex";
    }

    protected isWorking(text: string): boolean {
        return /Working \(\d+s • esc to interrupt\)/.test(text);
    }

    protected isComposerIdle(text: string): boolean {
        return text.includes(COMPOSER_IDLE_MARKER);
    }

    /**
     * Codex renders the elicitation as a numbered list using the schema's verbatim
     * enumNames ("Yes, I confirm"/"No, I do not confirm"), so type the label.
     */
    protected override async sendChoice(choice: "confirm" | "decline"): Promise<void> {
        const label = choice === "decline" ? "No, I do not confirm" : "Yes, I confirm";
        await this.terminal.type(label);
        await this.terminal.keyboard.press("Enter");
    }

    protected extractToolCalls(delta: string): ToolCallRecord[] {
        return parseTuiTranscript(delta).toolCalls;
    }
}
