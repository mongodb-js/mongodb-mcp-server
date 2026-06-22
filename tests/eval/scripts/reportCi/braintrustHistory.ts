import Braintrust from "@braintrust/api";
import type { Experiment } from "@braintrust/api/resources/shared.js";

import type { TimelinePoint } from "./types.js";

/** Max number of pages to fetch from the API. */
const MAX_PAGES = 10;
/** Max number of experiments per page to fetch from the API. */
const MAX_PAGE_SIZE = 100;
/** Upper bound on experiments streamed from `experiments.list` before stopping. */
const MAX_EXPERIMENTS = MAX_PAGE_SIZE * MAX_PAGES;
/** Max concurrency to fetch experiments and score percentages. */
const FETCH_CONCURRENCY = 5;
/** Max history rows included in timeline (report copy should reference this same value). */
const BRANCH_HISTORY_CHART_CAP = 10;

/** Log history-fetch progress to stderr (same channel as other reportCi messages). */
function logHistoryProgress(message: string): void {
    console.error(`history: ${message}`);
}

export type FetchBranchHistoryOpts = {
    apiKey: string;
    orgName: string;
    projectName: string;
    scoreName: string;
    gitBranchName: string;
};

/** Run up to `limit` async mappers over `items` concurrently and return results in order. */
async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = Array.from({ length: items.length }, () => undefined as R);
    const lock = { next: 0 };
    /** Pull the next item index and map it until the list is exhausted. */
    async function worker(): Promise<void> {
        while (true) {
            const idx = lock.next++;
            if (idx >= items.length) break;
            results[idx] = await fn(items[idx]!);
        }
    }
    const pool = Math.min(Math.max(1, items.length), limit);
    await Promise.all(Array.from({ length: pool }, () => worker()));
    return results;
}

/** Fetch summarized scores for one experiment via `experiments.summarize`. */
async function fetchScorePercent(
    client: Braintrust,
    experimentId: string,
    scoreName: string
): Promise<{ pct?: number; experimentUrl?: string }> {
    try {
        const summary = await client.experiments.summarize(experimentId, { summarize_scores: true });
        const raw = summary.scores?.[scoreName]?.score;
        if (typeof raw !== "number" || Number.isNaN(raw)) {
            return { experimentUrl: summary.experiment_url ?? undefined };
        }
        return {
            pct: raw * 100,
            experimentUrl: summary.experiment_url ?? undefined,
        };
    } catch {
        return {};
    }
}

/** Page through experiments in the eval project */
async function* listExperiments(client: Braintrust, orgName: string, projectName: string): AsyncGenerator<Experiment> {
    const listParams = {
        project_name: projectName,
        org_name: orgName,
        limit: MAX_PAGE_SIZE,
    };

    let count = 0;
    for await (const experiment of client.experiments.list(listParams)) {
        yield experiment;
        if (++count >= MAX_EXPERIMENTS) break;
    }
}

function printDate(date: Date): string {
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
}

/** List branch-filtered experiments, attach score percentages, sort, and cap for the chart. */
async function fetchExperimentHistory(
    client: Braintrust,
    orgName: string,
    projectName: string,
    scoreName: string,
    gitBranchName: string
): Promise<TimelinePoint[]> {
    logHistoryProgress(`listing experiments in \`${projectName}\` on branch \`${gitBranchName}\`...`);

    const rows: Experiment[] = [];
    let scanned = 0;
    for await (const experiment of listExperiments(client, orgName, projectName)) {
        scanned++;
        if (scanned % 50 === 0) {
            logHistoryProgress(`scanned ${scanned} experiment(s), ${rows.length} on branch so far`);
        }
        if (gitBranchName.toLowerCase() === experiment.repo_info?.branch?.toLowerCase()) {
            rows.push(experiment);
            logHistoryProgress(
                `found ${rows.length} experiments on branch \`${gitBranchName}\`: ${experiment.name ?? experiment.id}`
            );
            if (rows.length >= BRANCH_HISTORY_CHART_CAP) break;
        }
    }

    if (rows.length === 0) {
        logHistoryProgress(`no experiments on branch \`${gitBranchName}\` after scanning ${scanned}`);
        return [];
    }

    logHistoryProgress(`fetching \`${scoreName}\` scores for ${rows.length} experiment(s)...`);
    let scored = 0;
    const withScores = await parallelMap(rows, FETCH_CONCURRENCY, async (row) => {
        const { pct, experimentUrl } = await fetchScorePercent(client, row.id, scoreName);
        scored++;
        logHistoryProgress(`fetched score for ${scored}/${rows.length}: ${row.name ?? row.id}`);
        return { row, pct, experimentUrl };
    });

    const points: TimelinePoint[] = [];
    for (const { row, pct, experimentUrl } of withScores) {
        if (pct === undefined) continue;
        const created = row.created ?? row.repo_info?.commit_time ?? undefined;
        const d = created ? new Date(created) : null;
        const label = d && !Number.isNaN(d.getTime()) ? printDate(d) : row.id.slice(0, 8);

        const commit = row.repo_info?.commit;
        points.push({
            label,
            percent: pct,
            experimentId: row.id,
            experimentName: row.name,
            experimentUrl,
            commitShort: commit ? commit.slice(0, 7) : undefined,
        });
    }

    points.sort((a, b) => a.label.localeCompare(b.label));
    logHistoryProgress(`done, ${points.length} timeline point(s) with scores`);
    return points;
}

/**
 * Loads filtered-branch experiment timeline with scores (public REST API).
 * Throws on API failure so callers can fail the CI run.
 */
export async function fetchBranchHistory(opts: FetchBranchHistoryOpts): Promise<TimelinePoint[]> {
    logHistoryProgress(`fetching branch history (org \`${opts.orgName}\`, project \`${opts.projectName}\`)...`);
    const client = new Braintrust({ apiKey: opts.apiKey });
    return fetchExperimentHistory(client, opts.orgName, opts.projectName, opts.scoreName, opts.gitBranchName);
}
