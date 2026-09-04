export interface ToolCallRecord {
    /** Normalized tool name, e.g. "mcp__server__list-databases" -> "list-databases". */
    name: string;
    /** The raw tool name as reported by the harness, when it differs. */
    rawName?: string;
    /** Tool arguments as reported by the harness (best-effort). */
    args?: unknown;
}

export interface AgentTurn {
    /** Raw terminal content captured at the end of the turn (scrollback delta + live viewport). */
    text: string;
    /** Tool calls observed during the turn, deduplicated. */
    toolCalls: ToolCallRecord[];
    /** "elicitation" when the turn paused for a confirmation; otherwise "completed". */
    state: AgentTurnState;
    /** Raw confirmation screen when `state` is "elicitation". */
    confirmation?: string;
}

/** How a turn ended: completed normally, or paused for an elicitation confirmation. */
export type AgentTurnState = "completed" | "elicitation";

export interface AgentHarnessOptions {
    /**
     * URL of the MongoDB MCP server (streamable HTTP), e.g.
     * `http://127.0.0.1:PORT/mcp`. Mutually exclusive with `stdioServer`.
     */
    serverUrl?: string;
    /**
     * Stdio server spec; when set, the harness spawns the MCP server itself.
     * Mutually exclusive with `serverUrl`.
     */
    stdioServer?: { command: string; args: string[]; env: Record<string, string> };
    /** Name under which the MCP server is registered with the harness. */
    mcpServerName?: string;
    /** Working directory for the harness session (created by the test). */
    workDir: string;
    /** Optional model override (harness/provider default used when omitted). */
    model?: string;
    /** Timeout for a single `prompt()` call (ms). */
    promptTimeoutMs?: number;
    /** Dump the generated config (redacted) to the test logs. */
    debug?: boolean;
}

export interface AgentHarness {
    readonly name: string;
    /**
     * True when the binary + auth are available (tests skip otherwise).
     * Must be synchronous: `describe.skipIf` treats a Promise as truthy.
     */
    isAvailable(): boolean;
    start(options: AgentHarnessOptions): Promise<AgentSession>;
}

export interface AgentSession {
    /**
     * Run one turn: submit the prompt and wait. Resolves with
     * `state: "elicitation"` when the agent is awaiting a confirmation
     * (call {@link AgentSession.chooseOption}), else `state: "completed"`.
     */
    prompt(prompt: string): Promise<AgentTurn>;
    /**
     * Answer a pending elicitation (`confirm`/`decline`) and run the turn to
     * completion, returning the completed `AgentTurn`.
     */
    chooseOption(choice: "confirm" | "decline"): Promise<AgentTurn>;
    /** Current state of the last turn: "completed" or "elicitation". */
    readonly state: AgentTurnState;
    /** Release any resources. */
    dispose(): Promise<void>;
}

/** Config generator for an agent CLI harness: builds agent-specific config content for a hermetic session. */
export interface AgentHarnessConfig {
    /**
     * Env var pointing the agent at its config home (e.g. `"CODEX_HOME"`);
     * set to a per-session hermetic directory.
     */
    readonly homeDirEnvVar: string;

    /** Config file within the home dir (e.g. `"config.toml"`); empty when the config is the whole home dir. */
    readonly configFileName: string;

    /** The developer's real config home (e.g. `~/.codex`), read without mutating it. */
    getHostHomeDir(): string;

    /**
     * Build the agent-specific config file content for a hermetic session.
     * @param sessionHomeDir per-session hermetic home the file is written into
     *        (configs can reference files placed next to it).
     */
    buildConfig(options: AgentHarnessOptions, sessionHomeDir: string): string;
}
