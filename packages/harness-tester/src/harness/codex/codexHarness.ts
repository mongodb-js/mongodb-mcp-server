import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { TuiTest, type Backend } from "@microsoft/tui-test";
import { CodexHarnessConfig } from "./codexConfig.js";
import { resolveBackend } from "../shared.js";
import { HarnessLogger } from "../logger.js";
import { CodexTuiSession, type CodexState } from "./codexSession.js";
import type { AgentHarness, AgentHarnessOptions, AgentSession } from "../types.js";

export interface CodexTuiHarnessOptions {
    /** Override the codex binary path (default: "codex" on PATH). */
    binaryPath?: string;
    /** tui-test emulator backend (default: "alacritty", override for CI). */
    backend?: Backend;
    /** Terminal size in cells (default: 180x50). */
    cols?: number;
    rows?: number;
    /** Per-poll state callback for tests that want to observe/live-debug the TUI. */
    onState?: (state: CodexState) => void;
}

export class CodexTuiHarness implements AgentHarness {
    readonly name = "codex-tui";

    private readonly binaryPath: string | undefined;
    private readonly backend: Backend;
    private readonly cols: number;
    private readonly rows: number;
    private readonly onState: ((state: CodexState) => void) | undefined;
    private readonly log = new HarnessLogger(this.name);

    constructor(options: CodexTuiHarnessOptions = {}) {
        this.binaryPath = options.binaryPath;
        this.backend = resolveBackend(options.backend);
        this.cols = options.cols ?? 180;
        this.rows = options.rows ?? 50;
        this.onState = options.onState;
    }

    getBinaryPath(): string {
        return this.binaryPath ?? process.env.AGENT_E2E_CODEX_BIN ?? "codex";
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
            this.log.info(`binary '${binary}' not available; skipping agent e2e tests`);
            return false;
        }
        if (process.env.GROVE_API_KEY) {
            return true;
        }
        this.log.info("no GROVE_API_KEY set; skipping agent e2e tests");
        return false;
    }

    async start(options: AgentHarnessOptions): Promise<AgentSession> {
        // Per-session CODEX_HOME: developer config untouched, no state reused across sessions.
        const config = new CodexHarnessConfig();
        const codexHome = path.join(options.workDir, `codex-home-${Math.random().toString(36).slice(2, 8)}`);
        await fs.mkdir(codexHome, { recursive: true });
        const configToml = config.buildConfig(options, codexHome);
        await fs.writeFile(path.join(codexHome, config.configFileName), configToml);

        const terminal = new TuiTest(`codex-${process.pid}-${Math.random().toString(36).slice(2, 8)}`, {
            backend: this.backend,
            timeouts: { ready: 60_000, text: 60_000, idle: 60_000 },
        });
        await terminal.run(this.getBinaryPath(), [], {
            cwd: options.workDir,
            cols: this.cols,
            rows: this.rows,
            env: {
                ...process.env,
                CODEX_HOME: codexHome,
                TERM: "xterm-256color",
            },
            waitReady: false,
        });

        const session = new CodexTuiSession(terminal, options, this.onState);
        await session.initialise();
        return session;
    }
}
