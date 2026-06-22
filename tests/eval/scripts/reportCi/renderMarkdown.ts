import type { ParsedEvalSummary, TimelinePoint } from "./types.js";

export type RenderMarkdownOpts = {
    evalExitCode: number | null;
    current: ParsedEvalSummary;
    chartPoints: TimelinePoint[];
    scoreName: string;
};

/** Read `scoreName` from an eval summary and return accuracy as 0–100 percent, or undefined. */
function scorePercentFromSummary(summary: ParsedEvalSummary, scoreName: string): number | undefined {
    const s = summary.scores?.[scoreName]?.score;
    return typeof s === "number" && !Number.isNaN(s) ? s * 100 : undefined;
}

/** Sanitize a label for use inside mermaid xychart quoted strings. */
function escapeMermaidLabel(s: string): string {
    return s.replace(/"/g, "'").replace(/[[\]]/g, "");
}

/** Build a mermaid `xychart-beta` fenced block for accuracy over time. */
function renderMermaidXychart(points: TimelinePoint[]): string {
    if (points.length === 0) {
        return [
            "```mermaid",
            "xychart",
            '    title "No data points for chart"',
            '    x-axis ["n/a"]',
            '    y-axis "Accuracy (%)" 0 --> 100',
            "    bar [0]",
            "    line [0]",
            "```",
        ].join("\n");
    }
    const labels = points.map((p) => `"${escapeMermaidLabel(p.isCurrent ? "This run" : p.label)}"`);
    const values = points.map((p) => Math.round(p.percent * 10) / 10);
    return [
        "```mermaid",
        "---",
        "config:",
        "   xyChart:",
        "       showDataLabel: true",
        "       showDataLabelOutsideBar: true",
        "   themeVariables:",
        "       xyChart:",
        "           titleColor: 'orange'",
        "---",
        "xychart",
        '    title "accuracy"',
        `    x-axis [${labels.join(", ")}]`,
        '    y-axis "Accuracy (%)" 0 --> 100',
        `    bar [${values.join(", ")}]`,
        `    line [${values.join(", ")}]`,
        "```",
    ].join("\n");
}

/** Assemble the full CI report markdown (current run, chart, history table, footer). */
export function renderMarkdown(opts: RenderMarkdownOpts): string {
    const { evalExitCode, current, chartPoints, scoreName } = opts;
    const accPct = scorePercentFromSummary(current, scoreName);
    const pass = evalExitCode === 0;

    const lines: string[] = [
        "# Braintrust eval CI report",
        "",
        "## Current run",
        "",
        "| Field | Value |",
        "| --- | --- |",
        `| **Status** | ${pass ? "passed" : "failed"} |`,
        `| **Eval exit code** | ${evalExitCode ?? "unknown"} |`,
        `| **${scoreName} (accuracy %)** | ${accPct !== undefined ? `${accPct.toFixed(2)}%` : "n/a"} |`,
        `| **Experiment** | ${current.experimentName ?? "n/a"} |`,
        `| **Experiment ID** | \`${current.experimentId ?? "n/a"}\` |`,
        `| **Experiment URL** | ${current.experimentUrl ? `[link](${current.experimentUrl})` : "n/a"} |`,
    ];
    if (current.comparisonExperimentName) {
        lines.push(`| **Baseline** | ${current.comparisonExperimentName} |`);
    }
    lines.push("", "## Accuracy timeline (historical + this run)", "", renderMermaidXychart(chartPoints), "");

    if (chartPoints.length > 0) {
        lines.push("| Date / id | Commit | Accuracy | Experiment |", "| --- | --- | --- | --- |");
        for (const p of chartPoints.slice(-15)) {
            const label = p.isCurrent ? "This run" : p.label;
            const url = p.experimentUrl ? `[${p.experimentName}](${p.experimentUrl})` : p.experimentName;
            lines.push(`| ${label} | ${p.commitShort ?? "—"} | ${p.percent.toFixed(2)}% | ${url} |`);
        }
        lines.push("");
    }

    return lines.join("\n");
}
