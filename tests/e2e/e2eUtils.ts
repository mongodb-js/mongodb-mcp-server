import { execFile, type ChildProcess } from "child_process";
import { afterEach } from "vitest";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const CLI_PATH = path.join(import.meta.dirname, "..", "..", "dist", "esm", "index.js");

type RunServerFunction = ({
    args,
    dryRun,
    stripWhitespace,
}: {
    args: string[];
    /** `true` by default so no server is started unnecessarily */
    dryRun?: boolean;
    /** `true` by default so whitespace is stripped from the output */
    stripWhitespace?: boolean;
}) => Promise<ReturnType<typeof execFileAsync>>;

export function useCliRunner(): { runServer: RunServerFunction } {
    /**
     * Tracks spawned processes that need to be killed after tests
     */
    const trackedProcesses = new Set<ChildProcess>();

    async function runServer({
        args,
        dryRun = true,
        stripWhitespace = false,
    }: {
        args: string[];
        /** `true` by default so no server is started unnecessarily */
        dryRun?: boolean;
        /** `true` by default so whitespace is stripped from the output */
        stripWhitespace?: boolean;
    }): ReturnType<RunServerFunction> {
        const result = await execFileAsync(process.execPath, [CLI_PATH, ...args, ...(dryRun ? ["--dryRun"] : [])]);
        if (stripWhitespace) {
            result.stdout = result.stdout.replace(/\s/g, "");
        }
        return result;
    }

    // Clean up all processes after tests complete
    afterEach(() => {
        for (const proc of trackedProcesses) {
            if (proc.pid && !proc.killed) {
                proc.kill("SIGKILL");
            }
        }
        trackedProcesses.clear();
    });

    return {
        runServer,
    };
}
