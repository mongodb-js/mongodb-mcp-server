export interface ToolCallRecord {
    /** Normalized tool name, e.g. "mcp__server__list-databases" -> "list-databases". */
    name: string;
    /** The raw tool name as reported by the harness, when it differs. */
    rawName?: string;
    /** Tool arguments as reported by the harness (best-effort). */
    args?: unknown;
}

export interface AgentTurn {
    /** The agent's final textual reply. */
    text: string;
    /** Tool calls observed during the turn, deduplicated. */
    toolCalls: ToolCallRecord[];
    /** Raw harness output for the turn (terminal transcript for the TUI harness). */
    transcript?: string;
}

export interface AgentHarnessOptions {
    /**
     * URL of the MongoDB MCP server (streamable HTTP transport), e.g.
     * `http://127.0.0.1:PORT/mcp`. The server is started in-process by the
     * test (see agentTestUtils.ts) and the harness connects to it over HTTP.
     * Mutually exclusive with `stdioServer`.
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
     * True when the harness binary + auth are available in the current
     * environment (binary on PATH, and either GROVE_API_KEY or a stored
     * provider login). Tests use this to skip gracefully on machines
     * without the harness or without credentials.
     *
     * Must be synchronous: it is consumed by `describe.skipIf(...)`, which
     * treats a Promise as truthy and would otherwise always skip.
     */
    isAvailable(): boolean;
    start(options: AgentHarnessOptions): Promise<AgentSession>;
}

export interface AgentSession {
    /** Run one turn: submit the prompt, wait for the composer to return to idle, parse the transcript. */
    prompt(prompt: string): Promise<AgentTurn>;
    /** Release any resources. */
    dispose(): Promise<void>;
}

/**
 * Configuration generator for a coding-agent CLI harness: builds the
 * agent-specific config content for a hermetic session (the file layout and
 * non-interactive knobs differ per agent; see the architecture doc above for
 * the flow the harness drives around it).
 */
export interface AgentHarnessConfig {
    /**
     * Name of the environment variable that points the agent at its config
     * home (e.g. `"CODEX_HOME"`, `"CLAUDE_CONFIG_DIR"`). The harness sets this
     * to a per-session hermetic directory on the spawned process.
     */
    readonly homeDirEnvVar: string;

    /**
     * Path of the config file within the agent's home dir (relative), e.g.
     * `"config.toml"` for codex. The harness writes `buildConfig` output
     * here. Empty string when the config is the whole home dir.
     */
    readonly configFileName: string;

    /**
     * The agent's config home on the host machine (e.g. `~/.codex`), resolved
     * from the env var or the platform default. Used to read the developer's
     * real config (model choice, auth presence) without mutating it.
     */
    getHostHomeDir(): string;

    /**
     * Build the agent-specific config file content for a hermetic session.
     *
     * @param options the generic harness options (server URL / stdio spec,
     *        workdir, model, ...).
     * @param sessionHomeDir the per-session hermetic home the file will be
     *        written into; configs that need to reference files they place
     *        next to the config (e.g. codex's model catalog copy) use it.
     */
    buildConfig(options: AgentHarnessOptions, sessionHomeDir: string): string;

    /**
     * Return a copy of the config with secrets redacted so it is safe to
     * print in test logs. The default may be the identity for agents whose
     * configs hold no secrets (e.g. `env_key` references rather than literal
     * values), but implementations should redact anything sensitive.
     */
    redactSecrets(config: string): string;
}
