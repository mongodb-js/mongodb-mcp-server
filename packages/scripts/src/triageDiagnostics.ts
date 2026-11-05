import { z } from "zod/v4";
import { APICallError } from "ai";
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
    "report-quality":
        "The model report did not meet the evidence and content requirements. No comment is proposed. Use --debug to inspect report-revision feedback; this is not a JSON schema error.",
    "missing-release-commit":
        "The published release commit is missing locally. Fetch the intended release objects yourself, or provide a known --release-ref override.",
    "release-resolution":
        "Published release metadata could not be mapped to verified source. Check release metadata or supply a known --release-ref; do not substitute main.",
    "repository-evidence":
        "Repository evidence is unavailable or incomplete. Check --repo, --ref and --release-ref, local Git objects, source availability and model limits.",
    network: "An upstream network request failed. Check connectivity and retry later.",
    "model-request":
        "The model endpoint rejected the inference request. Check the selected model's tool-choice and structured-output support; use --debug for bounded provider details. This rejection is not retried.",
    "model-output":
        "The model response reached its output-token limit and is incomplete. No comment is proposed. For report truncation, increase --report-tokens or use a model that produces a concise complete assessment. Increasing --steps does not increase the per-response output limit.",
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

type DebugCause = {
    type: string;
    httpStatus?: number;
    code?: string;
    providerCode?: string;
    parameter?: string;
    mentionedParameters?: string[];
    responseBody?: string;
    responseBodyTruncated?: boolean;
};

export function redactDebugText(text: string): string {
    const secrets = Object.entries(process.env)
        .filter(
            ([name, value]) => /authorization|cookie|api[-_]?key|token|password|secret|credential/i.test(name) && value
        )
        .flatMap(([, value]) => (value ? [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)] : []))
        .sort((left, right) => right.length - left.length);
    for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
    return text
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [REDACTED]")
        .replace(
            /\b(authorization|cookie|api[-_]?key|token|password|secret|credential)\s*[:=]\s*[^\s,;<>]+/gi,
            "$1=[REDACTED]"
        );
}

export function debugToolCall(call: { toolName: string; toolCallId: string; input: unknown }): {
    tool: string;
    callId: string;
    details: Record<string, string | number | boolean>;
} {
    const fields: Record<string, string[]> = {
        dependencyPaths: ["target", "name", "importer", "includeDev", "maxPaths"],
        readProductArtifact: ["pathContains", "offset", "limit"],
        listFiles: ["target", "pathContains"],
        readFile: ["target", "path", "startLine", "lineCount"],
        search: ["target", "pathContains", "offset", "startLine", "limit"],
        readAdvisory: ["id", "descriptionOffset", "descriptionCharacters", "referenceOffset", "referenceLimit"],
        readGitHubReference: ["url", "path", "page", "patchOffset", "view", "startLine", "lineCount"],
        readReference: ["url", "startLine", "lineCount"],
        readGitHubSource: ["repository", "commit", "path", "pathContains", "startLine", "lineCount"],
        readDependency: ["name", "version", "path", "pathContains", "startLine", "lineCount"],
        readPackageVersions: ["name", "major", "offset", "limit", "requestedVersion"],
        searchDependency: ["name", "version", "pathContains"],
    };
    const details: Record<string, string | number | boolean> = {};
    const input = z.record(z.string(), z.unknown()).safeParse(call.input);
    const selectedFields = Object.hasOwn(fields, call.toolName) ? (fields[call.toolName] ?? []) : [];
    for (const field of selectedFields) {
        const value = input.success ? input.data[field] : undefined;
        if (typeof value === "string") {
            let text = value;
            if (field === "url") {
                try {
                    const url = new URL(value);
                    text = `${url.origin}${url.pathname}`;
                } catch {
                    text = "[invalid URL]";
                }
            }
            details[field] = redactDebugText(text).slice(0, 240);
        } else if (typeof value === "number" && Number.isFinite(value)) details[field] = value;
        else if (typeof value === "boolean") details[field] = value;
    }
    return {
        tool: Object.hasOwn(fields, call.toolName) ? call.toolName : "unknown-tool",
        callId: redactDebugText(call.toolCallId).slice(0, 200),
        details,
    };
}

// Known harness capability boundaries found in evidence outputs and tool-failure causes.
// Surfaced as the [triage-gaps] stderr event so unsupported evidence patterns are visible
// and the harness can be extended as vulnerability data drifts.
const capabilityPatterns: [RegExp, string][] = [
    [/Only pnpm v9 lockfiles are supported/i, "non-pnpm-v9-lockfile"],
    [/No tracked root pnpm-lock\.yaml/i, "missing-pnpm-lockfile"],
    [/Unsupported evidence host or report path|External evidence URL is not allowed/i, "unsupported-evidence-host"],
    [/No matching GitHub advisory/i, "advisory-not-in-global-database"],
    [/Non-registry resolution requires separate source evidence/i, "non-registry-dependency"],
    [/Kondukto access unavailable|Unsupported Kondukto finding URL/i, "kondukto-access"],
    [/Cannot infer a published product from a private package/i, "private-package"],
    [/"ecosystem":"(?!npm")[a-z]+"/i, "non-npm-advisory-ecosystem"],
];

export function capabilityGaps(texts: Iterable<string>): string[] {
    const found = new Set<string>();
    for (const text of texts) {
        for (const match of text.matchAll(/"capability":\s*"([\w-]+)"/g)) if (match[1]) found.add(match[1]);
        for (const [pattern, capability] of capabilityPatterns) if (pattern.test(text)) found.add(capability);
    }
    return [...found].sort();
}

export function toolFailureEvidence(call: { toolName: string; input: unknown }, error: unknown): string {
    const diagnostic = diagnoseFailure(error);
    const messages: string[] = [];
    for (let current: unknown = error; current instanceof Error; current = current.cause)
        messages.push(current.message);
    const capability = capabilityPatterns.find(([pattern]) => messages.some((message) => pattern.test(message)))?.[1];
    const details = debugToolCall({ ...call, toolCallId: "failure" }).details;
    const causes = debugFailure(error).causes;
    const httpStatus = causes.find((cause) => cause.httpStatus)?.httpStatus;
    let reason = diagnostic.guidance;
    let recovery = "Check the requested resource and access before retrying; failure is not proof of non-impact.";
    if (diagnostic.category === "missing-resource") {
        reason = "The upstream service returned HTTP 404 for this resource.";
        if (["readDependency", "searchDependency"].includes(call.toolName)) {
            reason = `npm returned HTTP 404 for ${String(details.name ?? "the package")}@${String(details.version ?? "the requested version")}. It may never have been published or may have been unpublished; this response does not distinguish those cases.`;
            recovery =
                "Use readPackageVersions to discover versions currently advertised by npm; do not guess a patched version.";
        } else if (typeof details.url === "string" && details.url.includes("/releases/tag/")) {
            reason =
                "GitHub returned HTTP 404 for the release notes. An npm version or Git tag can exist without a GitHub Release page.";
            recovery =
                "Use npm version metadata and the advisory's pinned fix/source references instead of assuming the package release is absent.";
        }
    }
    const invalidInput = causes.some((cause) => cause.type === "AI_InvalidToolInputError");
    if (invalidInput) {
        reason = "The tool arguments did not match its schema; the request was rejected before execution.";
        recovery =
            "Correct the arguments using the tool schema. Empty path filters are allowed for paged repository searches.";
    }
    return JSON.stringify({
        evidenceStatus: "unavailable",
        reasonCode: invalidInput ? "invalid-tool-input" : diagnostic.category,
        reason,
        recovery,
        ...(capability ? { capability } : {}),
        ...(httpStatus ? { httpStatus } : {}),
    });
}

function providerBodyPreview(error: unknown): Pick<DebugCause, "responseBody" | "responseBodyTruncated"> {
    if (!APICallError.isInstance(error) || !error.responseBody) return {};
    const sensitiveField = /authorization|cookie|api[-_]?key|token|password|secret|credential/i;
    let preview = error.responseBody.slice(0, 32_768);
    try {
        const parsed: unknown = JSON.parse(preview, (key: string, value: unknown): unknown =>
            sensitiveField.test(key) ? "[REDACTED]" : value
        );
        preview = JSON.stringify(parsed) ?? preview;
    } catch {
        preview = error.responseBody.slice(0, 32_768);
    }
    preview = redactDebugText(preview);
    return {
        responseBody: preview.slice(0, 4096),
        responseBodyTruncated: error.responseBody.length > 32_768 || preview.length > 4096,
    };
}

function providerDebugDetails(error: unknown): Pick<DebugCause, "providerCode" | "parameter" | "mentionedParameters"> {
    if (
        !APICallError.isInstance(error) ||
        !error.responseBody ||
        error.responseBody.length > 32_768 ||
        Buffer.byteLength(error.responseBody, "utf8") > 32_768
    )
        return {};
    let body: unknown;
    try {
        body = JSON.parse(error.responseBody);
    } catch {
        return {};
    }
    const parsed = z
        .object({
            error: z.object({
                code: z.string().nullish(),
                type: z.string().nullish(),
                param: z.string().nullish(),
                message: z.string().optional(),
            }),
        })
        .safeParse(body);
    if (!parsed.success) return {};
    const knownCodes = new Set([
        "invalid_request_error",
        "invalid_request",
        "unsupported_parameter",
        "unsupported_value",
        "BadRequest",
        "InvalidRequest",
        "invalid_json_schema",
        "model_not_found",
        "unsupported_response_format",
        "tool_choice_not_supported",
        "not_supported",
        "validation_error",
    ]);
    const parameters = [
        "tool_choice",
        "response_format",
        "tools",
        "parallel_tool_calls",
        "max_tokens",
        "max_completion_tokens",
        "temperature",
        "top_p",
        "model",
        "messages",
        "thinking",
    ];
    const value = parsed.data.error;
    const providerCode = [value.code, value.type].find((code) => code && knownCodes.has(code));
    const parameter = value.param && parameters.includes(value.param) ? value.param : undefined;
    const mentionedParameters = parameters.filter((name) => value.message?.includes(name));
    return {
        ...(providerCode ? { providerCode } : {}),
        ...(parameter ? { parameter } : {}),
        ...(mentionedParameters.length ? { mentionedParameters } : {}),
    };
}

export function debugFailure(error: unknown): {
    causes: DebugCause[];
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
    const causes: DebugCause[] = [];
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
            ...providerDebugDetails(current),
            ...providerBodyPreview(current),
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
        if (code === 400 && APICallError.isInstance(candidate)) return result("model-request");
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
