import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TuiTest } from "@microsoft/tui-test";
import { TuiSessionBase, dumpSessionSnapshots, resetSessionSnapshots } from "./tuiSession.js";
import { parseTuiTranscript } from "./codex/codexParseTuiTranscript.js";
import { CodexTuiSession } from "./codex/codexSession.js";
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

    describe("elicitation choices", () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it("rejects a choice without a pending elicitation", async () => {
            const terminal = createFakeTerminal({ viewportAt: () => "IDLE" });
            const press = vi.spyOn(terminal.keyboard, "press");
            const session = new FakeSession({ terminal, options: { workDir: "/tmp" } });

            await expect(session.chooseOption("confirm")).rejects.toThrow("no pending elicitation");
            expect(press).not.toHaveBeenCalled();
        });

        it("rejects a choice after the prompt times out", async () => {
            const terminal = createFakeTerminal({ viewportAt: () => "WORKING" });
            const session = new FakeSession({ terminal, options: { workDir: "/tmp", promptTimeoutMs: 600 } });

            const turnPromise = session.prompt("drop the database");
            await vi.runAllTimersAsync();
            expect((await turnPromise).text).toContain("ERROR:");

            await expect(session.chooseOption("confirm")).rejects.toThrow("no pending elicitation");
        });

        it("completes a resumed turn without waiting to observe more activity", async () => {
            let answered = false;
            const terminal = createFakeTerminal({ viewportAt: () => (answered ? "IDLE" : "CONFIRM") });
            const session = new FakeSession({ terminal, options: { workDir: "/tmp", promptTimeoutMs: 2000 } });

            const turnPromise = session.prompt("drop the database");
            await vi.runAllTimersAsync();
            expect((await turnPromise).state).toBe("elicitation");

            answered = true;
            const afterPromise = session.chooseOption("confirm");
            await vi.runAllTimersAsync();
            const after = await afterPromise;
            expect(after.state).toBe("completed");
            expect(after.text).not.toContain("ERROR:");
            expect(session.state).toBe("completed");
            await expect(session.chooseOption("confirm")).rejects.toThrow("no pending elicitation");
        });

        it.each(["confirm", "decline"] as const)("submits the Codex %s choice once", async (choice) => {
            let answered = false;
            const terminal = createFakeTerminal({
                viewportAt: (): string =>
                    answered
                        ? "› Ask Codex to do anything"
                        : "Field 1/1\nWould you like to confirm?\n› 1. Yes, I confirm\n  2. No, I do not confirm",
            });
            const session = new CodexTuiSession({
                terminal,
                options: { workDir: "/tmp", promptTimeoutMs: 2000 },
                onState: (): void => {},
            });
            const turnPromise = session.prompt("drop the database");
            await vi.runAllTimersAsync();
            expect((await turnPromise).state).toBe("elicitation");

            const type = vi.spyOn(terminal, "type");
            const press = vi.spyOn(terminal.keyboard, "press").mockImplementation((key) => {
                if (key === "Enter") answered = true;
                return Promise.resolve();
            });
            const afterPromise = session.chooseOption(choice);
            await vi.runAllTimersAsync();

            expect((await afterPromise).text).not.toContain("ERROR:");
            expect(type).not.toHaveBeenCalled();
            expect(press.mock.calls).toEqual(choice === "confirm" ? [["Enter"]] : [["Down"], ["Enter"]]);
        });
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

describe("TuiSessionBase turn completion", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("does not finish on a brief Codex idle frame before an elicitation", async () => {
        const terminal = createFakeTerminal({
            viewportAt: (call): string => {
                if (call === 1 || call === 3) {
                    return "• Working (5s • esc to interrupt)\n› Ask Codex to do anything";
                }
                if (call === 2) {
                    return "• I'll locate and run the database drop tool.\n› Ask Codex to do anything";
                }
                return "Field 1/1\nWould you like to confirm?\n› 1. Yes, I confirm\n  2. No, I do not confirm";
            },
        });
        const session = new CodexTuiSession({
            terminal,
            options: { workDir: "/tmp", promptTimeoutMs: 4000 },
            onState: (): void => {},
        });

        const turnPromise = session.prompt("drop the database");
        await vi.runAllTimersAsync();

        expect((await turnPromise).state).toBe("elicitation");
    });

    it("does not treat codex's just-submitted prompt as an elicitation", async () => {
        // After Enter codex renders the submitted prompt with neither the working
        // marker nor the idle composer; that transient frame must not be reported
        // as an elicitation before the turn has begun.
        const promptEcho = '› Use "drop-database" tool to drop the "db" database.';
        let viewportReads = 0;
        const terminal = createFakeTerminal({
            viewportAt: (call): string => {
                viewportReads = call;
                if (call <= 3) return promptEcho;
                if (call === 4) return "• Working (1s • esc to interrupt)";
                return "Would you like to confirm?\n› 1. Yes, I confirm\n  2. No, I do not confirm";
            },
        });
        const session = new CodexTuiSession({
            terminal,
            options: { workDir: "/tmp", promptTimeoutMs: 10_000 },
            onState: (): void => {},
        });

        const turnPromise = session.prompt("drop the database");
        await vi.runAllTimersAsync();
        const turn = await turnPromise;

        expect(turn.state).toBe("elicitation");
        expect(turn.confirmation).toContain("confirm");
        expect(viewportReads).toBeGreaterThanOrEqual(5);
    });

    it("requires uninterrupted idle polls after the last working frame", async () => {
        let viewportReads = 0;
        const terminal = createFakeTerminal({
            viewportAt: (call): string => {
                viewportReads = call;
                return call === 1 || call === 3 ? "WORKING" : "IDLE";
            },
        });
        const session = new FakeSession({ terminal, options: { workDir: "/tmp", promptTimeoutMs: 4000 } });

        const turnPromise = session.prompt("list the databases");
        await vi.runAllTimersAsync();
        const turn = await turnPromise;

        expect(turn.text).not.toContain("ERROR:");
        expect(turn.state).toBe("completed");
        expect(viewportReads).toBeGreaterThanOrEqual(6);
    });

    it("does not finish while a transitional banner accompanies an idle composer", async () => {
        const terminal = createFakeTerminal({
            viewportAt: (call): string => {
                if (call === 1) return "WORKING";
                if (call <= 5) return "STARTUP\nIDLE";
                return "CONFIRM";
            },
        });
        const session = new TransitionalSession({ terminal, options: { workDir: "/tmp", promptTimeoutMs: 5000 } });

        const turnPromise = session.prompt("drop the database");
        await vi.runAllTimersAsync();

        expect((await turnPromise).state).toBe("elicitation");
    });
});

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

/** Capture `console.log` for the duration of `fn` (the logger writes there). */
async function captureLogs(fn: () => unknown): Promise<string> {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]): void => void lines.push(args.join(" "));
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines.join("\n");
}

describe("TuiSessionBase failure snapshots", () => {
    beforeEach(() => resetSessionSnapshots());

    it("prints nothing on its own, even when a turn times out", async () => {
        const terminal = createFakeTerminal({ viewportAt: () => "WORKING" });
        const session = new FakeSession({ terminal, options: { workDir: "/tmp", promptTimeoutMs: 600 } });

        const output = await captureLogs(async () => {
            await session.prompt("list the databases");
            await session.dispose();
        });

        expect(output).not.toContain("poll snapshot(s) follow");
    });

    /** The test may fail on an assertion after a turn the harness considered complete. */
    it("keeps the history of a completed turn for a later dump", async () => {
        const terminal = createFakeTerminal({ viewportAt: (call) => (call === 1 ? "WORKING" : "IDLE") });
        const session = new FakeSession({ terminal, options: { workDir: "/tmp" } });

        const turn = await session.prompt("list the databases");
        await session.dispose();
        expect(turn.state).toBe("completed");

        const output = await captureLogs(() => dumpSessionSnapshots("test failed"));

        expect(output).toContain("test failed; last");
        expect(output).toContain("=== new turn (prompt) ===");
        expect(output).toContain("working=true");
    });

    /** A vitest-level timeout abandons the turn mid-poll, so the session never returns. */
    it("dumps the history of an abandoned turn", async () => {
        const terminal = createFakeTerminal({ viewportAt: () => "WORKING" });
        const session = new FakeSession({ terminal, options: { workDir: "/tmp", promptTimeoutMs: 10_000 } });

        void session.prompt("list the databases");
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const output = await captureLogs(() => dumpSessionSnapshots("test timed out"));
        await session.dispose();

        expect(output).toContain("test timed out; last");
        expect(output).toContain("working=true");
    });

    it("forgets sessions from earlier tests after a reset", async () => {
        const terminal = createFakeTerminal({ viewportAt: (call) => (call === 1 ? "WORKING" : "IDLE") });
        const session = new FakeSession({ terminal, options: { workDir: "/tmp" } });
        await session.prompt("list the databases");

        resetSessionSnapshots();
        const output = await captureLogs(() => dumpSessionSnapshots("test failed"));

        expect(output).toBe("");
    });
});
