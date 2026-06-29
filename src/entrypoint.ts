#!/usr/bin/env node
import * as path from "node:path";
import { spawn } from "node:child_process";

const target = path.resolve(process.argv[1] ?? "", "..", "index.js");
spawn(
    process.execPath,
    [
        ...process.execArgv,
        "--permission",
        "--allow-fs-read=*",
        `--allow-fs-write=${process.env.HOME}/.mongodb`,
        target,
        ...process.argv.slice(2),
    ],
    {
        stdio: "inherit",
    }
).on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
    } else {
        process.exit(code ?? 0);
    }
});
