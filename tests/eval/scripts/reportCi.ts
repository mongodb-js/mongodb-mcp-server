/**
 * CI helper: runs `bt eval --jsonl …` (args after `--`), tees stdout to the console (stderr is
 * inherited for TTY progress bars), fetches main-branch experiment history via `@braintrust/api`
 * (before spawning eval so a baseline experiment name can be injected), and writes `.eval/ci-report.md` for
 * GitHub PR comments.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { fetchBranchHistory } from "./reportCi/braintrustHistory.js";
import { renderMarkdown } from "./reportCi/renderMarkdown.js";
import type { ParsedEvalSummary, TimelinePoint } from "./reportCi/types.js";

const ORG_NAME = "mongodb-education-ai";
const PROJECT_NAME = "mongodb-mcp-server-evals";
const SCORE_NAME = "llm_judge";
/** Git branch name used when querying Braintrust experiment history for the chart. */
const HISTORY_BRANCH = "main";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(scriptDir, "..", "..", "..", ".eval", "ci-report.md");

/** Return argv tokens after the first `--` (the eval command to spawn). Exits with usage if missing. */
function parseArgsAfterDashDash(): string[] {
    const idx = process.argv.indexOf("--");
    if (idx === -1 || idx === process.argv.length - 1) {
        console.error(
            "Usage: tsx tests/eval/scripts/reportCi.ts -- <command> [args...]\n" +
                "Example: tsx tests/eval/scripts/reportCi.ts -- bt eval --jsonl tests/eval/mongodb.eval.ts"
        );
        process.exit(2);
    }
    return process.argv.slice(idx + 1);
}

/** Stream stdout line-by-line via readline, teeing each line to the console as it arrives. */
async function* evalLines(stdout: Readable): AsyncGenerator<string> {
    const rl = createInterface({ input: stdout, crlfDelay: Infinity });
    for await (const line of rl) {
        process.stdout.write(`${line}\n`);
        yield line;
    }
}

/**
 * Parse a single `bt eval --jsonl` line. The reporter prints `JSON.stringify(summary)` (an
 * ExperimentSummary); some wrappers nest it under `summary`. Non-JSON log lines yield `undefined`.
 */
function parseSummaryLine(line: string): ParsedEvalSummary | undefined {
    const t = line.trim();
    if (!(t && t.startsWith("{") && t.endsWith("}"))) {
        return undefined;
    }

    const obj = JSON.parse(t) as Record<string, unknown>;
    return obj.summary ?? obj;
}

/**
 * Spawn the eval subprocess, parse stdout line-by-line for the latest ExperimentSummary,
 * and return the child exit code plus that summary. Stderr is inherited so `cli-progress`
 * bars render (they require a TTY); stdout stays piped for JSONL capture.
 * When `baseExperimentName` is set, passes it as `EVAL_BASE_EXPERIMENT_NAME` for `Eval({ baseExperimentName })`.
 */
async function runEvalCommand(
    argv: string[],
    baseExperimentName?: string
): Promise<{ exitCode: number | null; summary: ParsedEvalSummary }> {
    const [cmd, ...args] = argv;
    if (!cmd) {
        console.error("reportCi: no command after --");
        return { exitCode: 2, summary: {} };
    }

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...(baseExperimentName ? { EVAL_BASE_EXPERIMENT_NAME: baseExperimentName } : {}),
    };
    const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "inherit"], env });
    if (!child.stdout) {
        return { exitCode: 1, summary: {} };
    }

    // Resolves with the exit code on close; rejects on spawn failure (e.g. ENOENT).
    const closed = new Promise<number | null>((resolve, reject) => {
        child.once("close", resolve);
        child.once("error", reject);
    });

    const captureStdout = (async (): Promise<ParsedEvalSummary> => {
        let summary: ParsedEvalSummary = {};
        for await (const line of evalLines(child.stdout)) {
            summary = parseSummaryLine(line) ?? summary;
        }
        return summary;
    })();

    try {
        const [summary, exitCode] = await Promise.all([captureStdout, closed]);
        return { exitCode, summary };
    } catch (err) {
        console.error("reportCi: failed to spawn eval command:", err);
        return { exitCode: 1, summary: {} };
    }
}

/** Merge historical timeline points with the current run (deduped by experiment id) for the chart. */
function buildChartPoints(history: TimelinePoint[], current: ParsedEvalSummary): TimelinePoint[] {
    const currentId = current.experimentId;
    const filtered = currentId ? history.filter((p) => p.experimentId !== currentId) : [...history];

    const pct = current.scores?.[SCORE_NAME]?.score;
    if (typeof pct === "number" && !Number.isNaN(pct)) {
        filtered.push({
            label: "This_run",
            percent: pct * 100,
            experimentId: currentId ?? "current",
            experimentName: current.experimentName ?? "current",
            experimentUrl: current.experimentUrl,
            isCurrent: true,
        });
    }
    return filtered;
}

/** Fetch branch history, then run eval (with optional baseline from history), render markdown, write report. */
async function main(): Promise<void> {
    const apiKey = process.env.BRAINTRUST_API_KEY_OVERRIDE ?? process.env.BRAINTRUST_API_KEY;
    const orgName = process.env.BRAINTRUST_ORG_NAME || ORG_NAME;
    const projectName = process.env.BRAINTRUST_PROJECT_NAME || PROJECT_NAME;
    if (!apiKey) {
        throw new Error("BRAINTRUST_API_KEY is required to run the eval.");
    }

    const evalArgv = parseArgsAfterDashDash();
    const historyPoints = await fetchBranchHistory({
        apiKey,
        orgName,
        projectName,
        scoreName: SCORE_NAME,
        gitBranchName: HISTORY_BRANCH,
    });

    const explicitBase = process.env.EVAL_BASE_EXPERIMENT_NAME?.trim();
    const baseExperimentName = explicitBase || historyPoints.at(-1)?.experimentName;
    if (baseExperimentName) {
        console.error(
            `reportCi: EVAL_BASE_EXPERIMENT_NAME=${baseExperimentName} (${explicitBase ? "from env" : "from history (latest)"})`
        );
    }

    const { exitCode, summary: current } = await runEvalCommand(evalArgv, baseExperimentName);
    const chartPoints = buildChartPoints(historyPoints, current);

    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    const md = renderMarkdown({
        evalExitCode: exitCode,
        current,
        chartPoints,
        scoreName: SCORE_NAME,
    });
    writeFileSync(REPORT_PATH, md, "utf8");
    console.error(`reportCi: wrote ${REPORT_PATH}`);

    if (exitCode !== 0) {
        process.exit(exitCode ?? 1);
    }
}

void main().catch((e) => {
    console.error("reportCi:", e);
    try {
        mkdirSync(dirname(REPORT_PATH), { recursive: true });
        writeFileSync(
            REPORT_PATH,
            `# Braintrust eval CI report\n\n**Fatal error:** ${e instanceof Error ? e.message : String(e)}\n`,
            "utf8"
        );
    } catch {
        console.error("reportCi: failed to write report file:", e);
    }
    process.exit(1);
});
