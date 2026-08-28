import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { TuiTest, type Backend } from "@microsoft/tui-test";
import { ClaudeHarnessConfig, buildClaudeEnv, seedClaudeHome } from "./claudeConfig.js";
import { resolveBackend } from "../shared.js";
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

    /**
     * Synchronous (required by `describe.skipIf`): binary runs `--version`,
     * and auth counts as available when GROVE_API_KEY is set.
     */
    isAvailable(): boolean {
        const binary = this.getBinaryPath();
        try {
            execFileSync(binary, ["--version"], { timeout: 30_000, stdio: "ignore" });
        } catch {
            console.log(`[claude-tui] binary '${binary}' not available; skipping claude agent e2e tests`);
            return false;
        }
        if (process.env.GROVE_API_KEY) {
            return true;
        }
        console.log("[claude-tui] no GROVE_API_KEY set; skipping claude agent e2e tests");
        return false;
    }

    async start(options: AgentHarnessOptions): Promise<AgentSession> {
        // Per-session CLAUDE_CONFIG_DIR so the developer's config is untouched.
        const config = new ClaudeHarnessConfig();
        const claudeHome = path.join(options.workDir, "claude-home");
        await fs.mkdir(claudeHome, { recursive: true });

        // Pre-seed the onboarding/trust state and the MCP config file. The
        // settings seeded here whitelist the session to MCP tools only, so no
        // bypassPermissions / disallowedTools flags are needed on the CLI.
        const mcpServerName = options.mcpServerName ?? "mongo";
        seedClaudeHome(claudeHome, options.workDir, mcpServerName);
        const mcpConfig = config.buildConfig(options);
        const mcpConfigPath = path.join(claudeHome, config.configFileName);
        await fs.writeFile(mcpConfigPath, mcpConfig);

        if (options.debug) {
            console.log(`[claude-tui] ${config.configFileName}:\n${config.redactSecrets(mcpConfig)}`);
        }

        const terminal = new TuiTest(`claude-${process.pid}-${Math.random().toString(36).slice(2, 8)}`, {
            backend: this.backend,
            timeouts: { ready: 60_000, text: 60_000, idle: 60_000 },
        });
        await terminal.run(this.getBinaryPath(), ["--mcp-config", mcpConfigPath, "--strict-mcp-config"], {
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
        });

        const session = new ClaudeTuiSession(terminal, options, claudeHome, this.onState);
        await session.initialise();
        return session;
    }
}
