import path from "path";
import net from "net";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMcpCli } from "@mongodb-js/mcp-cli";

// Force the one path that does reject - a synchronous throw from serveStdio -
// so the stdio case below verifies the same flush-before-exit contract as HTTP.
vi.mock("@modelcontextprotocol/server/stdio", () => ({
    serveStdio: vi.fn(() => {
        throw new Error("stdio-crash");
    }),
}));

// Absolute path to the built server entry point (same convention as stdio.test.ts).
const currentDir = import.meta.dirname;
const projectRoot = path.resolve(currentDir, "../../../..");
const serverPath = path.resolve(projectRoot, "packages/mongodb-mcp-server/dist/esm/index.js");

const PROCESS_EXIT_TIMEOUT_MS = 30_000;
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGABRT", "SIGTERM", "SIGQUIT"] as const;

interface OccupiedPort {
    port: number;
    release: () => Promise<void>;
}

/** Binds a throwaway listener on an OS-assigned port so the spawned server hits EADDRINUSE. */
function occupyPort(): Promise<OccupiedPort> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            resolve({
                port,
                release: () => new Promise<void>((res) => server.close(() => res())),
            });
        });
    });
}

async function readAllLogs(directory: string): Promise<string> {
    const files = await fs.readdir(directory);
    const contents = await Promise.all(files.map((file) => fs.readFile(path.join(directory, file), "utf8")));
    return contents.join("\n");
}

/** Drop MDB_MCP_* env overrides so the test config comes purely from CLI args. */
function cleanEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key.startsWith("MDB_MCP_")) {
            delete env[key];
        }
    }
    return env;
}

describe("http startup failure disk logging", () => {
    let logPath: string;
    let occupied: OccupiedPort;

    beforeEach(async () => {
        logPath = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-486-http-"));
        occupied = await occupyPort();
    });

    afterEach(async () => {
        await occupied.release();
        await fs.rm(logPath, { recursive: true, force: true });
    });

    it("flushes the startup failure to the disk log before exiting non-zero", async () => {
        const child = spawn(
            "node",
            [
                serverPath,
                "--transport",
                "http",
                "--httpHost",
                "127.0.0.1",
                "--httpPort",
                String(occupied.port),
                "--telemetry",
                "disabled",
                "--loggers",
                "disk",
                "--logPath",
                logPath,
                "--disabledTools",
                "atlas-local",
            ],
            { stdio: "ignore", env: cleanEnv() }
        );

        const exitCode = await new Promise<number | null>((resolve, reject) => {
            const timer = setTimeout(() => {
                child.kill("SIGKILL");
                reject(new Error(`Server did not exit within ${PROCESS_EXIT_TIMEOUT_MS}ms`));
            }, PROCESS_EXIT_TIMEOUT_MS);

            child.once("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                resolve(code);
            });
        });

        // A startup failure must exit non-zero, and the buffered disk log must be
        // flushed before the process exits (the fix owned by runMcpCli's catch).
        expect(exitCode).toBe(1);

        const logs = await readAllLogs(logPath);
        expect(logs).toContain("Closing server due to error");
        expect(logs).toContain("EADDRINUSE");
    });
});

describe("stdio startup failure disk logging", () => {
    let logPath: string;
    let signalListenersBefore: Map<(typeof SHUTDOWN_SIGNALS)[number], NodeJS.SignalsListener[]>;

    beforeEach(async () => {
        logPath = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-486-stdio-"));
        signalListenersBefore = new Map(
            SHUTDOWN_SIGNALS.map((signal) => [signal, process.listeners(signal) as NodeJS.SignalsListener[]])
        );
    });

    afterEach(async () => {
        // startRunner registers process-level shutdown handlers; drop only the
        // ones this test added so they don't leak or fire across tests.
        for (const signal of SHUTDOWN_SIGNALS) {
            const original = signalListenersBefore.get(signal) ?? [];
            for (const listener of process.listeners(signal) as NodeJS.SignalsListener[]) {
                if (!original.includes(listener)) {
                    process.removeListener(signal, listener);
                }
            }
        }
        await fs.rm(logPath, { recursive: true, force: true });
        vi.clearAllMocks();
    });

    it("flushes the startup failure to the disk log before the error propagates", async () => {
        await expect(
            runMcpCli({
                args: [
                    "--transport",
                    "stdio",
                    "--telemetry",
                    "disabled",
                    "--loggers",
                    "disk",
                    "--logPath",
                    logPath,
                    "--disabledTools",
                    "atlas-local",
                ],
                serverMetadata: { mcpServerName: "MongoDB MCP Server", version: "1.2.3-test" },
                consoleLogger: console,
                onExit: vi.fn(),
                tools: [],
                resources: [],
            })
        ).rejects.toThrow("stdio-crash");

        const logs = await readAllLogs(logPath);
        expect(logs).toContain("Closing server due to error");
        expect(logs).toContain("stdio-crash");
    });
});
