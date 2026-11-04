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
        "Repository evidence is unavailable or incomplete. Check --repo, --ref and --release-ref, local Git objects, source availability and model limits.",
    network: "An upstream network request failed. Check connectivity and retry later.",
    configuration: "Check required environment variables and CLI arguments; use --help for configuration.",
    unknown:
        "Investigation failed; no write is proposed. Check configured access, repository targets and investigation limits.",
} as const;

export type FailureDiagnostic = { category: keyof typeof guidance; guidance: string };

export class TriageFailure extends Error {
    readonly category: FailureDiagnostic["category"];

    constructor(category: FailureDiagnostic["category"], options: ErrorOptions & { option?: string }) {
        super(`${options.option ? `Check ${options.option}. ` : ""}${guidance[category]}`, options);
        this.category = category;
    }
}

export function configurationValue<Value>(read: () => Value, option?: string): Value {
    try {
        return read();
    } catch (cause) {
        throw new TriageFailure("configuration", { cause, option });
    }
}

export function debugFailure(error: unknown): {
    causes: { type: string; httpStatus?: number; code?: string }[];
    truncated: boolean;
} {
    const knownTypes = new Set([
        "Error",
        "TypeError",
        "RangeError",
        "SyntaxError",
        "AbortError",
        "TimeoutError",
        "ZodError",
        "AI_APICallError",
        "AI_NoObjectGeneratedError",
        "AI_NoOutputGeneratedError",
        "AI_InvalidResponseDataError",
        "AI_JSONParseError",
        "AI_TypeValidationError",
        "AI_ToolExecutionError",
        "AI_InvalidToolInputError",
        "AI_ToolChoiceViolationError",
        "AI_NoSuchToolError",
        "AI_UnsupportedFunctionalityError",
        "AI_RetryError",
        "AI_MessageConversionError",
        "AI_InvalidArgumentError",
        "AI_EmptyResponseBodyError",
        "AI_InvalidPromptError",
    ]);
    const knownCodes = new Set([
        "ECONNREFUSED",
        "ECONNRESET",
        "ENOTFOUND",
        "ETIMEDOUT",
        "EAI_AGAIN",
        "ENOENT",
        "EACCES",
        "ERR_INVALID_URL",
        "ABORT_ERR",
    ]);
    const causes: { type: string; httpStatus?: number; code?: string }[] = [];
    const seen = new Set<unknown>();
    let current = error;
    while (current !== undefined && causes.length < 10 && !seen.has(current)) {
        seen.add(current);
        const metadata = z
            .object({
                statusCode: z.number().int().min(100).max(599).optional(),
                code: z.string().optional(),
            })
            .safeParse(current);
        causes.push({
            type: current instanceof Error && knownTypes.has(current.name) ? current.name : "unrecognized-error",
            ...(current instanceof EvidenceHttpError
                ? { httpStatus: current.status }
                : metadata.success && metadata.data.statusCode !== undefined
                  ? { httpStatus: metadata.data.statusCode }
                  : {}),
            ...(metadata.success && metadata.data.code && knownCodes.has(metadata.data.code)
                ? { code: metadata.data.code }
                : {}),
        });
        current = current instanceof Error ? current.cause : undefined;
    }
    return { causes, truncated: current !== undefined };
}

export function diagnoseFailure(error: unknown): FailureDiagnostic {
    const chain: unknown[] = [];
    let current = error;
    while (current !== undefined && chain.length < 10 && !chain.includes(current)) {
        chain.push(current);
        current = current instanceof Error ? current.cause : undefined;
    }
    const result = (category: keyof typeof guidance): FailureDiagnostic => ({ category, guidance: guidance[category] });
    const staged = chain.find((candidate) => candidate instanceof TriageFailure);
    if (staged instanceof TriageFailure) return { category: staged.category, guidance: staged.message };
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
