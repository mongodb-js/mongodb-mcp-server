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
}

/**
 * An interactive confirmation the agent surfaced mid-turn (e.g. an MCP
 * elicitation prompt for a confirmation-required tool). `text` is the raw
 * terminal content so tests can inspect the message/options.
 */
export interface AgentConfirmation {
    /** Raw terminal content at the confirmation prompt. */
    text: string;
}

/**
 * Chooses an option when the agent pauses mid-turn for a confirmation.
 * Receives the confirmation and returns the option to select.
 */
export type ConfirmationResponder = (confirmation: AgentConfirmation) => Promise<string> | string;

export interface PromptOptions {
    /**
     * Responds to an interactive confirmation the agent surfaces mid-turn (e.g.
     * an MCP elicitation). The returned string is the option to select. When
     * omitted, the harness waits for the turn to finish without answering.
     */
    onConfirmation?: ConfirmationResponder;
}

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
    /** Run one turn: submit the prompt, wait for the composer to return to idle, parse the transcript. */
    prompt(prompt: string, options?: PromptOptions): Promise<AgentTurn>;
    /**
     * Select an option in a confirmation prompt (e.g. an MCP elicitation). The
     * prompt is a multiple-choice list; `option` is the label to select.
     */
    chooseOption(option: string): Promise<void>;
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
