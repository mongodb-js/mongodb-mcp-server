import { z } from "zod/v4";
import { EvidenceHttpError } from "./triageEvidence.js";

const guidance = {
    "rate-limit":
        "Upstream rate limit reached. Retry the run later; increasing the local request budget does not bypass provider limits.",
    authentication: "Check the configured identity, token and model permissions; access was denied.",
    "missing-resource":
        "An upstream evidence resource was not found. Treat it as missing evidence, not proof of non-impact.",
    "upstream-unavailable":
        "The upstream service remained unavailable. Retry later; any permitted local retries were bounded.",
    "budget-exhausted":
        "An investigation request, context, archive or download budget was exhausted. Narrow the investigation or adjust the documented limits.",
    deadline:
        "The investigation timed out or was cancelled. Retry with a narrower scope or a larger deadline if appropriate.",
    "invalid-report":
        "The report or replay input is invalid JSON or does not match the required schema. No comment is proposed; inspect the saved input or model response in an approved environment.",
    "missing-release-commit":
        "The published release commit is missing locally. Fetch the intended release objects yourself, or provide a known --release-ref override.",
    "release-resolution":
        "Published release metadata could not be mapped to verified source. Check release metadata or supply a known --release-ref; do not substitute main.",
    "repository-evidence":
        "The investigation did not finish with evidence for both repository targets. Review scope, source availability and model limits.",
    network: "An upstream network request failed. Check connectivity and retry later.",
    configuration: "Check required environment variables and CLI arguments; use --help for configuration.",
    unknown:
        "Investigation failed; no write is proposed. Check configured access, repository targets and investigation limits.",
} as const;

export type FailureDiagnostic = { category: keyof typeof guidance; guidance: string };

export function diagnoseFailure(error: unknown): FailureDiagnostic {
    const chain: unknown[] = [];
    let current = error;
    while (current !== undefined && chain.length < 10 && !chain.includes(current)) {
        chain.push(current);
        current = current instanceof Error ? current.cause : undefined;
    }
    const result = (category: keyof typeof guidance): FailureDiagnostic => ({ category, guidance: guidance[category] });
    for (const candidate of chain.reverse()) {
        const status =
            candidate instanceof EvidenceHttpError
                ? candidate.status
                : z.object({ statusCode: z.number().optional() }).safeParse(candidate);
        const code = typeof status === "number" ? status : status.success ? status.data.statusCode : undefined;
        if (code === 429 || (candidate instanceof EvidenceHttpError && candidate.rateLimited))
            return result("rate-limit");
        if (code === 401 || code === 403) return result("authentication");
        if (code === 404) return result("missing-resource");
        if (code && code >= 500) return result("upstream-unavailable");
        if (!(candidate instanceof Error)) continue;
        const message = candidate.message;
        if (/budget exhausted|exceeds .*budget|archive budget|maxbuffer|outputlength/i.test(message))
            return result("budget-exhausted");
        if (/unavailable locally/i.test(message)) return result("missing-release-commit");
        if (/provenance|release source|resolve npm|source commit/i.test(message)) return result("release-resolution");
        if (candidate.name === "AbortError" || candidate.name === "TimeoutError" || /deadline exceeded/i.test(message))
            return result("deadline");
        if (candidate instanceof SyntaxError || candidate instanceof z.ZodError) return result("invalid-report");
        if (/^Replay (?:evidence|contains|JSONL|needs)/.test(message)) return result("invalid-report");
        if (/HTTP 429/i.test(message)) return result("rate-limit");
        if (/HTTP (401|403)/i.test(message)) return result("authentication");
        if (/HTTP 404/i.test(message)) return result("missing-resource");
        if (/did not finish with repository evidence/i.test(message)) return result("repository-evidence");
        if (/fetch failed|network|ECONN|connection reset/i.test(message)) return result("network");
        if (/is required|requires an explicit|unknown option/i.test(message)) return result("configuration");
    }
    return result("unknown");
}
