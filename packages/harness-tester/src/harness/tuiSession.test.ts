import { describe, expect, it } from "vitest";
import type { TuiTest } from "@microsoft/tui-test";
import { TuiSessionBase } from "./tuiSession.js";
import { parseTuiTranscript } from "./codex/codexParseTuiTranscript.js";
import type { AgentHarnessOptions, ToolCallRecord } from "./types.js";

const BEFORE = "› Ask Codex to do anything";
const TOOL_CALL = '• Called mongo.list-databases({"connectionId":"preconfigured"})';
const AFTER = `${BEFORE}\n${TOOL_CALL}\nWORKING`;

/**
 * Minimal stand-in for `TuiTest`. The first transcript read is the pre-prompt
 * snapshot (`prompt()` captures it); later reads are the live transcript. The
 * viewport is a function of the poll iteration so tests can transition states.
 */
function createFakeTerminal({ viewportAt }: { viewportAt: (call: number) => string }): TuiTest {
    let transcriptCalls = 0;
    let viewportCalls = 0;
    const terminal = {
        text: ({ full }: { full: boolean }): Promise<string> => {
            if (full) {
                transcriptCalls += 1;
                return Promise.resolve(transcriptCalls === 1 ? BEFORE : AFTER);
            }
            viewportCalls += 1;
            return Promise.resolve(viewportAt(viewportCalls));
        },
        getExitCode: (): Promise<number | null> => Promise.resolve(null),
        type: async (): Promise<void> => {},
        keyboard: { press: async (): Promise<void> => {} },
        closeQuiet: async (): Promise<void> => {},
    };
    return terminal as unknown as TuiTest;
}

/** Test session with deterministic markers and codex-style transcript parsing. */
class FakeSession extends TuiSessionBase {
    constructor(args: { terminal: TuiTest; options: AgentHarnessOptions }) {
        super({ terminal: args.terminal, options: args.options, onState: () => {} });
    }

    protected get label(): string {
        return "fake";
    }

    protected isWorking(text: string): boolean {
        return text.includes("WORKING");
    }

    protected isComposerIdle(text: string): boolean {
        return text.includes("IDLE");
    }

    protected async sendChoice(): Promise<void> {}

    protected extractToolCalls(delta: string): ToolCallRecord[] {
        return parseTuiTranscript(delta).toolCalls;
    }
}

describe("TuiSessionBase paused-turn retention", () => {
    it("keeps tool calls observed before an elicitation", async () => {
        const terminal = createFakeTerminal({ viewportAt: (call) => (call === 1 ? "WORKING" : "CONFIRM") });
        const session = new FakeSession({ terminal, options: { workDir: "/tmp" } });

        const turn = await session.prompt("list the databases");

        expect(turn.state).toBe("elicitation");
        expect(turn.toolCalls.some((tc) => tc.name === "list-databases")).toBe(true);
    });

    it("keeps tool calls observed before a timeout", async () => {
        const terminal = createFakeTerminal({ viewportAt: () => "WORKING" });
        const session = new FakeSession({ terminal, options: { workDir: "/tmp", promptTimeoutMs: 600 } });

        const turn = await session.prompt("list the databases");

        expect(turn.state).toBe("completed");
        expect(turn.text).toContain("ERROR:");
        expect(turn.toolCalls.some((tc) => tc.name === "list-databases")).toBe(true);
    });
});

/** Session whose transitional banner mirrors codex's pre-turn "Waiting for startup". */
class TransitionalSession extends FakeSession {
    protected override isTransitional(text: string): boolean {
        return text.includes("STARTUP");
    }
}

describe("TuiSessionBase pre-turn startup banners", () => {
    /**
     * Codex shows "Waiting for startup" (not idle, not working) before the turn
     * begins, then briefly renders an idle composer while it boots MCP servers.
     * The banner must not count as the turn starting, otherwise that idle poll
     * ends the turn before the agent has done anything.
     */
    it("does not treat a transitional banner as the turn starting", async () => {
        // 1-2: startup banner, 3: idle composer while booting, 4+: the real turn.
        const terminal = createFakeTerminal({
            viewportAt: (call) => {
                if (call <= 2) return "STARTUP";
                if (call === 3) return "IDLE";
                return call === 4 ? "WORKING" : "CONFIRM";
            },
        });
        const session = new TransitionalSession({ terminal, options: { workDir: "/tmp" } });

        const turn = await session.prompt("drop the database");

        // Without the guard this returns an empty "completed" turn at poll 3.
        expect(turn.state).toBe("elicitation");
    });
});
