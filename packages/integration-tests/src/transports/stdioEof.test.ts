import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { once } from "events";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

const currentDir = import.meta.dirname;
const projectRoot = path.resolve(currentDir, "../../../..");
const serverPath = path.resolve(projectRoot, "packages/mongodb-mcp-server/dist/esm/index.js");
const PROCESS_TIMEOUT_MS = 10_000;

function cleanEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key.startsWith("MDB_MCP_")) {
            delete env[key];
        }
    }
    return env;
}

describe("stdio EOF lifecycle", () => {
    let child: ChildProcessWithoutNullStreams | undefined;

    afterEach(() => {
        if (child?.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
        }
    });

    it("exits cleanly after an initialized client closes stdin", async () => {
        child = spawn(process.execPath, [serverPath, "--telemetry", "disabled", "--disabledTools", "atlas-local"], {
            env: {
                ...cleanEnv(),
                MDB_MCP_TRANSPORT: "stdio",
                MDB_MCP_CONNECTION_STRING: "",
            },
        });

        child.stdin.write(
            `${JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    protocolVersion: "2025-03-26",
                    capabilities: {},
                    clientInfo: { name: "stdio-eof-test", version: "1.0.0" },
                },
            })}\n`
        );

        const [response] = (await once(child.stdout, "data", {
            signal: AbortSignal.timeout(PROCESS_TIMEOUT_MS),
        })) as [Buffer];
        expect(response.toString()).toContain('"id":1');

        const exited = once(child, "exit", { signal: AbortSignal.timeout(PROCESS_TIMEOUT_MS) });
        child.stdin.end(
            `${JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/initialized",
                params: {},
            })}\n`
        );

        const [exitCode] = (await exited) as [number | null, NodeJS.Signals | null];
        expect(exitCode).toBe(0);
    });
});
