import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { TuiTest, type Backend } from "@microsoft/tui-test";
import {
    ClaudeHarnessConfig,
    buildClaudeEnv,
    DEFAULT_CLAUDE_EFFORT_LEVEL,
    resolveClaudeModel,
    seedClaudeHome,
} from "./claudeConfig.js";
import { resolveBackend } from "../shared.js";
import { HarnessLogger } from "../logger.js";
import { ClaudeTuiSession, type ClaudeState } from "./claudeSession.js";
import type { AgentHarness, AgentHarnessOptions, AgentSession } from "../types.js";

export interface ClaudeTuiHarnessOptions {
    /** Override the claude binary path (default: "claude" on PATH). */
    binaryPath?: string;
    /** tui-test emulator backend (default: "alacritty", override for CI). */
    backend?: Backend;
    /** Terminal size in cells (default: 180x50). */
    cols?: number;
    rows?: number;
    /** Per-poll state callback for tests that want to observe/live-debug the TUI. */
    onState?: (state: ClaudeState) => void;
}

export class ClaudeTuiHarness implements AgentHarness {
    readonly name = "claude-tui";

    private readonly binaryPath: string | undefined;
    private readonly backend: Backend;
    private readonly cols: number;
    private readonly rows: number;
    private readonly onState: ((state: ClaudeState) => void) | undefined;
    private readonly log = new HarnessLogger(this.name);

    constructor(options: ClaudeTuiHarnessOptions = {}) {
        this.binaryPath = options.binaryPath;
        this.backend = resolveBackend(options.backend);
        this.cols = options.cols ?? 180;
        this.rows = options.rows ?? 50;
        this.onState = options.onState;
    }

    getBinaryPath(): string {
        return this.binaryPath ?? process.env.AGENT_E2E_CLAUDE_BIN ?? "claude";
    }

    getBackend(): Backend {
        return this.backend;
    }

    /** Synchronous (required by `describe.skipIf`): binary `--version` + GROVE_API_KEY set. */
    isAvailable(): boolean {
        const binary = this.getBinaryPath();
        try {
            execFileSync(binary, ["--version"], { timeout: 30_000, stdio: "ignore" });
        } catch {
            this.log.info(`binary '${binary}' not available; skipping claude agent e2e tests`);
            return false;
        }
        if (process.env.GROVE_API_KEY) {
            return true;
        }
        this.log.info("no GROVE_API_KEY set; skipping claude agent e2e tests");
        return false;
    }

    async start(options: AgentHarnessOptions): Promise<AgentSession> {
        // Per-session CLAUDE_CONFIG_DIR: developer config untouched, no state or JSONL reused.
        const config = new ClaudeHarnessConfig();
        const claudeHome = path.join(options.workDir, `claude-home-${Math.random().toString(36).slice(2, 8)}`);
        await fs.mkdir(claudeHome, { recursive: true });

        // Pre-seed onboarding/trust state + MCP config (whitelists MCP tools, so no permission flags needed).
        const mcpServerName = options.mcpServerName ?? "mongo";
        seedClaudeHome(claudeHome, options.workDir, mcpServerName);
        const mcpConfig = config.buildConfig(options);
        const mcpConfigPath = path.join(claudeHome, config.configFileName);
        await fs.writeFile(mcpConfigPath, mcpConfig);

        const terminal = new TuiTest(`claude-${process.pid}-${Math.random().toString(36).slice(2, 8)}`, {
            backend: this.backend,
            timeouts: { ready: 60_000, text: 60_000, idle: 60_000 },
        });
        // `--model` (plus `ANTHROPIC_MODEL` in the env) pins haiku, and `--effort`
        // (plus `CLAUDE_CODE_EFFORT_LEVEL`) pins minimum reasoning: both outrank the
        // org default (Opus) and override-user-selection per Claude Code docs.
        await terminal.run(
            this.getBinaryPath(),
            [
                "--model",
                resolveClaudeModel(options),
                "--effort",
                DEFAULT_CLAUDE_EFFORT_LEVEL,
                "--mcp-config",
                mcpConfigPath,
                "--strict-mcp-config",
            ],
            {
                cwd: options.workDir,
                cols: this.cols,
                rows: this.rows,
                env: {
                    ...process.env,
                    ...buildClaudeEnv(options),
                    [config.homeDirEnvVar]: claudeHome,
                    TERM: "xterm-256color",
                },
                waitReady: false,
            }
        );

        const session = new ClaudeTuiSession(terminal, options, claudeHome, this.onState);
        await session.initialise();
        return session;
    }
}
