import type { TuiTest } from "@microsoft/tui-test";
import { parseTuiTranscript } from "./codexParseTuiTranscript.js";
import { isCodexComposerIdle, isCodexTransitional, isCodexWorking } from "./codexTuiMarkers.js";
import { TuiSessionBase, type TuiState } from "../tuiSession.js";
import type { AgentHarnessOptions, ToolCallRecord } from "../types.js";

export type CodexState = TuiState;

export class CodexTuiSession extends TuiSessionBase {
    constructor({
        terminal,
        options,
        onState,
    }: {
        terminal: TuiTest;
        options: AgentHarnessOptions;
        onState?: (state: TuiState) => void;
    }) {
        super({ terminal, options, onState });
    }

    protected get label(): string {
        return "codex";
    }

    protected isWorking(text: string): boolean {
        return isCodexWorking(text);
    }

    protected isComposerIdle(text: string): boolean {
        return isCodexComposerIdle(text);
    }

    protected override isTransitional(text: string): boolean {
        return isCodexTransitional(text);
    }

    /**
     * Codex renders the elicitation as a numbered picker with the cursor on the
     * first option, so navigate to the chosen option before submitting.
     */
    protected override async sendChoice(choice: "confirm" | "decline"): Promise<void> {
        if (choice === "decline") {
            await this.terminal.keyboard.press("Down");
        }
        await this.terminal.keyboard.press("Enter");
    }

    protected extractToolCalls(delta: string): ToolCallRecord[] {
        return parseTuiTranscript(delta).toolCalls;
    }
}
