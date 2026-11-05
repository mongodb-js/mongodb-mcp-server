import { createHash } from "node:crypto";
import { satisfies, valid, validRange } from "semver";
import { z } from "zod/v4";
import { toolFailureEvidence } from "./triageDiagnostics.js";

const textSchema = z.string().min(1).max(1600);
const citationSchema = z
    .object({ evidenceId: z.string().min(1).max(200), locator: z.string().min(1).max(500) })
    .strict();
const claimSchema = z.object({ text: textSchema, citations: z.array(citationSchema).max(12) }).strict();
const targetSchema = z
    .object({
        recommendation: z.enum(["likely-affected", "likely-not-affected", "needs-investigation"]),
        summary: textSchema,
        packageName: z.string().min(1).max(214),
        resolvedVersions: z
            .array(
                z.object({ version: z.string().min(1).max(100), citations: z.array(citationSchema).max(12) }).strict()
            )
            .max(30),
        affectedRange: z.string().max(500),
        advisory: claimSchema,
        dependencyPath: claimSchema,
        affectedBehavior: claimSchema,
        callerTrace: claimSchema,
        packaging: claimSchema,
        prerequisites: z
            .array(
                z
                    .object({
                        condition: textSchema,
                        status: z.enum(["met", "not-met", "unknown"]),
                        evidence: claimSchema,
                    })
                    .strict()
            )
            .max(12),
        exclusion: z
            .object({
                basis: z.enum(["unaffected-version", "not-shipped", "unreachable-behavior", "prerequisite-not-met"]),
                evidence: claimSchema,
            })
            .strict()
            .nullable(),
        missingEvidence: z.array(textSchema).max(20),
        limitations: z.array(textSchema).max(20),
        nextSteps: z.array(textSchema).max(12),
    })
    .strict();

export const assessmentSchema = z
    .object({ summary: textSchema, targets: z.object({ release: targetSchema, main: targetSchema }).strict() })
    .strict();
export type Assessment = z.infer<typeof assessmentSchema>;
export type EvidenceRecord = {
    id: string;
    tool: string;
    target?: "main" | "release";
    input: unknown;
    output: string;
    sha256: string;
    availability: "retrieved" | "limited" | "unavailable";
    issue?: { reason: string; recovery: string };
};
type TargetAssessment = Assessment["targets"]["main"];
export type CheckedAssessment = {
    summary: string;
    humanDecisionRequired: true;
    targets: Record<
        "main" | "release",
        { assessment: TargetAssessment; recommendation: TargetAssessment["recommendation"]; checks: string[] }
    >;
};
const investigationScopeSchema = z
    .object({
        main: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/i) }).strict(),
        release: z
            .object({
                commit: z.string().regex(/^[a-f0-9]{40}$/i),
                name: z.string().min(1).max(214),
                version: z.string().min(1).max(100),
                label: z.string().min(1).max(2000),
            })
            .strict()
            .nullable(),
    })
    .strict();
export type InvestigationScope = z.infer<typeof investigationScopeSchema>;
export type InvestigationResult = {
    body: string;
    scope: InvestigationScope | null;
    assessment: CheckedAssessment;
    evidence: EvidenceRecord[];
};

export function renderInvestigationScope(scope: InvestigationScope | null): string {
    if (!scope)
        return "Assessment scope: UNKNOWN. This older ledger has no structured target identities; do not infer commits or release identity from model prose.";
    return `Assessment scope: current-main commit ${scope.main.commit}; released-product ${scope.release ? `${plain(scope.release.name)}@${plain(scope.release.version)} (${plain(scope.release.label)}), commit ${scope.release.commit}` : "not provided (released-product impact unknown)"}.`;
}

export const ASSESSMENT_INSTRUCTIONS =
    "The Jira reader needs a direct answer, not an investigation transcript. Each target summary must be at most 90 words and 600 characters: one or two short plain-language sentences stating whether we are likely affected and the decisive reason. Name the relevant package/version or product behavior in ordinary language. Do not include tool IDs, JSON, audit logs, questions, checklists, or requests for routine human verification in summaries. If genuinely undecidable, state the single decisive missing fact and why it prevents an answer. Do not default to needs-investigation merely because certainty is not absolute. Resolve answer-changing gaps yourself using the available tools. Stop when a supported exclusion settles applicability; unrelated unknowns belong in limitations, not missingEvidence. nextSteps may be empty; do not manufacture work for the reviewer. Detailed claims and citations are internal audit data, not the comment.\n" +
    "A schema-shaped placeholder is not a report. Never use placeholder, x, TBD or generic filler. Summarize the actual retrieved findings with citations even when the recommendation is needs-investigation. Explain the scope of empty dependency graphs rather than reporting all facts as unknown; distinguish selected production roots from build/dev dependencies and bundled copies. Read relevant target manifests and production entry points, complete advisory pages and relevant fix/source references before stopping when the tools and budget allow it. missingEvidence is reserved for evidence the tools cannot retrieve within budget: fully read packaging scripts, manifests and artifact inventories before declaring packaging unverified, and never list a gap you could close with an available read. Every unknown must explain what is missing and why it matters, with concrete blocking gaps and follow-up. Each target must cite at least one actual target-specific finding. Use retrieved advisories rather than discarding their facts.\n" +
    "Return ONLY a JSON object matching the following schema, without Markdown fences or prose outside JSON. This is advisory investigation for a human decision, never an authorization to close, accept risk, or remediate a ticket. Cite actual tool-call IDs as evidenceId and use locator for the exact file:line range or reference section inspected. Never invent IDs, versions, call paths, or exclusions. Ground resolvedVersions in cited dependencyPaths occurrences or the matching product artifact manifest; source text alone is not machine-verified resolution. For version-based recommendations cite readAdvisory or a GitHub advisory reference containing non-withdrawn npm vulnerability records for this package, and use the union of their affected ranges without guessing. List only answer-changing unresolved gaps in missingEvidence; nonblocking caveats belong in limitations. Use needs-investigation when evidence necessary for the conclusion is missing, not when an irrelevant field is unknown. For unknown or unnecessary claims provide a candid explanation and empty citations; affectedRange may be empty and exclusion null. Assess release and main independently.\n" +
    JSON.stringify(z.toJSONSchema(assessmentSchema));

export function reportQualityIssues(assessment: Assessment, evidence: EvidenceRecord[]): string[] {
    const issues: string[] = [];
    const substantive = (text: string): boolean =>
        text.trim().length >= 24 &&
        !/^(?:(?:placeholder|todo|tbd|investigating|pending|x)[\s.!]*)+$/i.test(text.trim());
    if (!substantive(assessment.summary))
        issues.push("Report summary must describe actual findings, not placeholders.");
    for (const target of ["release", "main"] as const) {
        const proposed = assessment.targets[target];
        const claims = [
            proposed.advisory,
            proposed.dependencyPath,
            proposed.affectedBehavior,
            proposed.callerTrace,
            proposed.packaging,
        ];
        const allClaims = [
            ...claims,
            ...proposed.prerequisites.map((item) => item.evidence),
            ...(proposed.exclusion ? [proposed.exclusion.evidence] : []),
            ...proposed.resolvedVersions.map((version) => ({ text: version.version, citations: version.citations })),
        ];
        for (const citation of allClaims.flatMap((claim) => claim.citations)) {
            const matches = evidence.filter((record) => record.id === citation.evidenceId);
            if (
                matches.length !== 1 ||
                matches[0]?.availability === "unavailable" ||
                (matches[0]?.target && matches[0].target !== target)
            ) {
                issues.push(
                    `${target}: replace invalid, unavailable, ambiguous or wrong-target citation ${citation.evidenceId} with evidence actually retrieved for this claim; if unavailable, remove the citation and describe the answer-changing gap instead.`
                );
            }
        }
        const decisiveClaims =
            proposed.recommendation === "likely-not-affected" &&
            ["unaffected-version", "not-shipped"].includes(proposed.exclusion?.basis ?? "")
                ? [proposed.advisory, proposed.dependencyPath, proposed.packaging]
                : claims;
        if (!substantive(proposed.summary) || decisiveClaims.some((claim) => !substantive(claim.text)))
            issues.push(
                `${target}: explain the findings or the specific unknown for every report field; placeholders are not findings.`
            );
        if (proposed.summary.length > 600 || proposed.summary.trim().split(/\s+/).length > 90)
            issues.push(`${target}: shorten the reader-facing summary to at most 90 words and 600 characters.`);
        if (proposed.nextSteps.some((text) => !substantive(text)))
            issues.push(`${target}: provide concrete follow-up actions, not placeholder next steps.`);
        if (
            proposed.recommendation === "needs-investigation" &&
            (!proposed.missingEvidence.length || proposed.missingEvidence.some((text) => !substantive(text)))
        )
            issues.push(`${target}: needs-investigation requires concrete blocking evidence gaps.`);
        const usable = (claim: z.infer<typeof claimSchema>): EvidenceRecord[] =>
            claim.citations.flatMap((citation) => {
                const matches = evidence.filter((record) => record.id === citation.evidenceId);
                return matches.length === 1 &&
                    matches[0]?.availability !== "unavailable" &&
                    (!matches[0]?.target || matches[0].target === target)
                    ? matches
                    : [];
            });
        if (
            !claims.some((claim) =>
                usable(claim).some(
                    (record) =>
                        record.target === target &&
                        ["dependencyPaths", "readFile", "search", "readProductArtifact"].includes(record.tool)
                )
            )
        )
            issues.push(`${target}: cite at least one retrieved target-specific finding and explain its scope.`);
        const packaging = evidence.filter(
            (record) => record.target === target && ["readFile", "readProductArtifact"].includes(record.tool)
        );
        if (
            !packaging.length ||
            (packaging.some((record) => record.availability !== "unavailable") &&
                !usable(proposed.packaging).some(
                    (record) => record.target === target && ["readFile", "readProductArtifact"].includes(record.tool)
                ))
        )
            issues.push(
                `${target}: inspect target manifests/entry points or the released artifact, and cite the packaging findings; failed access must be an explicit gap.`
            );
        const graphs = evidence.filter(
            (record) =>
                record.target === target &&
                record.tool === "dependencyPaths" &&
                z.object({ name: z.literal(proposed.packageName) }).safeParse(record.input).success
        );
        const productionAbsence = graphs.some((record) => {
            try {
                return z
                    .object({
                        productCoverage: z.object({
                            resolutionComplete: z.literal(true),
                            occurrences: z.array(z.unknown()).length(0),
                        }),
                    })
                    .safeParse(JSON.parse(record.output)).success;
            } catch {
                return false;
            }
        });
        if (
            productionAbsence &&
            !graphs.some(
                (record) =>
                    z.object({ importer: z.literal("*"), includeDev: z.literal(true) }).safeParse(record.input).success
            )
        )
            issues.push(
                `${target}: the production graph has no copy; query dependencyPaths with importer=* and includeDev=true to investigate build/dev copies before reporting, and distinguish them from shipped dependencies.`
            );
        if (
            evidence.some((record) => record.tool === "readAdvisory" && record.availability === "retrieved") &&
            !usable(proposed.advisory).some((record) =>
                ["readAdvisory", "readReference", "readGitHubReference"].includes(record.tool)
            )
        )
            issues.push(`${target}: use the retrieved advisory and cite its affected behavior and applicability.`);
    }
    return issues;
}

export function evidenceRecord(input: { id: string; tool: string; input: unknown; output: string }): EvidenceRecord {
    let outcome: { evidenceStatus: "limited" | "unavailable"; reason: string; recovery: string } | undefined;
    try {
        const parsed = z
            .object({
                evidenceStatus: z.enum(["limited", "unavailable"]),
                reason: z.string().min(1).max(1000),
                recovery: z.string().min(1).max(1000),
            })
            .safeParse(JSON.parse(input.output));
        if (parsed.success) outcome = parsed.data;
    } catch {
        outcome = undefined;
    }
    const request = z
        .object({ target: z.enum(["main", "release"]).optional() })
        .passthrough()
        .safeParse(input.input);
    const repositoryTool = ["readFile", "search", "listFiles", "dependencyPaths"].includes(input.tool);
    const target =
        input.tool === "readProductArtifact"
            ? "release"
            : repositoryTool
              ? request.success
                  ? (request.data.target ?? "main")
                  : "main"
              : undefined;
    const unavailable =
        (!input.output.trim() && !["listFiles", "search", "searchDependency"].includes(input.tool)) ||
        /(?:^|\n)(?:No (?!matches\b)|Not an allowed|Too many|(?:Repository|External evidence) context budget exhausted)/i.test(
            input.output.trim()
        );
    const limited = /\[TRUNCATED|"resolutionComplete":\s*false|"truncated":\s*true/i.test(input.output);
    let issue: EvidenceRecord["issue"];
    if (outcome) issue = { reason: outcome.reason, recovery: outcome.recovery };
    else if (unavailable || limited) {
        issue = {
            reason: limited
                ? "The returned content is incomplete or exceeds the per-result limit."
                : "The requested evidence was not returned.",
            recovery: limited
                ? "Request a narrower file or line range, or follow the returned continuation."
                : "Check the resource identity and use discovery before retrying.",
        };
        if (input.output.startsWith("Too many candidate files"))
            issue = {
                reason: "The search selected more than 100 files and was rejected before reading them.",
                recovery: "Use a narrower path or the paged search continuation.",
            };
        if (/^No (?:readable regular file|file available)/.test(input.output))
            issue = {
                reason: "The requested file is absent from the pinned source or package archive.",
                recovery:
                    "List files first and use an exact returned path; archive contents may differ from upstream source.",
            };
    }
    return {
        ...input,
        target,
        sha256: createHash("sha256").update(input.output).digest("hex"),
        availability: outcome?.evidenceStatus ?? (unavailable ? "unavailable" : limited ? "limited" : "retrieved"),
        ...(issue ? { issue } : {}),
    };
}

export function collectEvidence(
    steps: readonly {
        toolCalls: readonly { toolCallId: string; toolName: string; input: unknown }[];
        toolResults: readonly { toolCallId: string; toolName: string; input: unknown; output: unknown }[];
        content?: readonly { type: string; toolCallId?: string; error?: unknown }[];
    }[]
): EvidenceRecord[] {
    return steps.flatMap((step) =>
        step.toolCalls.map((call) => {
            const entry = step.toolResults.find(
                (returned) => returned.toolCallId === call.toolCallId && returned.toolName === call.toolName
            );
            return evidenceRecord({
                id: call.toolCallId,
                tool: call.toolName,
                input: entry?.input ?? call.input,
                output: entry
                    ? typeof entry.output === "string"
                        ? entry.output
                        : (JSON.stringify(entry.output) ?? "")
                    : toolFailureEvidence(
                          call,
                          step.content?.find(
                              (part) => part.type === "tool-error" && part.toolCallId === call.toolCallId
                          )?.error
                      ),
            });
        })
    );
}

export function replayInvestigation(raw: unknown): {
    dryRun: true;
    replay: true;
    issue: string;
    action: "replay" | "skip-replay";
    reason?: string;
    body?: string;
    investigation?: Omit<InvestigationResult, "body">;
    previousRecommendations?: Record<"main" | "release", TargetAssessment["recommendation"]>;
    recommendationChanged?: boolean;
} {
    const header = z
        .object({
            dryRun: z.literal(true),
            issue: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/),
            action: z.enum(["skip", "create-comment", "update-comment", "replay", "skip-replay"]),
        })
        .parse(raw);
    if (header.action === "skip" || header.action === "skip-replay")
        return {
            dryRun: true,
            replay: true,
            issue: header.issue,
            action: "skip-replay",
            reason: "Cached skip entry has no fresh investigation ledger to replay.",
        };
    const recommendationSchema = targetSchema.shape.recommendation;
    const savedTarget = z.object({ assessment: targetSchema, recommendation: recommendationSchema });
    const saved = z
        .object({
            investigation: z.object({
                scope: investigationScopeSchema.nullable().optional(),
                assessment: z.object({
                    summary: textSchema,
                    humanDecisionRequired: z.literal(true),
                    targets: z.object({ main: savedTarget, release: savedTarget }),
                }),
                evidence: z
                    .array(
                        z.object({
                            id: z.string().min(1).max(200),
                            tool: z.string().min(1).max(100),
                            input: z.unknown(),
                            output: z.string().max(20_000),
                            sha256: z.string().regex(/^[a-f0-9]{64}$/),
                        })
                    )
                    .max(10_000),
            }),
        })
        .parse(raw).investigation;
    const evidence = saved.evidence.map((record) => {
        const reconstructed = evidenceRecord(record);
        if (reconstructed.sha256 !== record.sha256)
            throw new Error("Replay evidence output hash mismatch; refusing to recheck altered evidence");
        return reconstructed;
    });
    if (new Set(evidence.map((record) => record.id)).size !== evidence.length)
        throw new Error("Replay contains duplicate evidence IDs");
    const assessment = checkAssessment(
        {
            summary: saved.assessment.summary,
            targets: {
                main: saved.assessment.targets.main.assessment,
                release: saved.assessment.targets.release.assessment,
            },
        },
        evidence
    );
    const previousRecommendations = {
        main: saved.assessment.targets.main.recommendation,
        release: saved.assessment.targets.release.recommendation,
    };
    return {
        dryRun: true,
        replay: true,
        issue: header.issue,
        action: "replay",
        previousRecommendations,
        recommendationChanged:
            previousRecommendations.main !== assessment.targets.main.recommendation ||
            previousRecommendations.release !== assessment.targets.release.recommendation,
        investigation: { scope: saved.scope ?? null, assessment, evidence },
        body:
            "OFFLINE REPLAY: saved evidence only; sources and release mappings have NOT been refreshed. No Jira write is proposed.\n\n" +
            renderInvestigationScope(saved.scope ?? null) +
            "\n\n" +
            renderAssessment(assessment, { evidence }),
    };
}

export function checkAssessment(raw: unknown, evidence: EvidenceRecord[]): CheckedAssessment {
    const assessment = assessmentSchema.parse(raw);
    const check = (target: "main" | "release"): CheckedAssessment["targets"]["main"] => {
        const proposed = assessment.targets[target];
        const checks = new Set<string>();
        const citations = (values: z.infer<typeof citationSchema>[]): EvidenceRecord[] => {
            const records: EvidenceRecord[] = [];
            for (const citation of values) {
                const matches = evidence.filter((record) => record.id === citation.evidenceId);
                const record = matches[0];
                if (
                    matches.length !== 1 ||
                    !record ||
                    record.availability === "unavailable" ||
                    (record.target && record.target !== target)
                ) {
                    checks.add(`Invalid, unavailable, ambiguous, or wrong-target evidence: ${citation.evidenceId}`);
                } else records.push(record);
            }
            return records;
        };
        const support = (
            claim: z.infer<typeof claimSchema>,
            options: { scoped?: boolean; tools?: string[]; source?: boolean } = {}
        ): boolean => {
            const records = citations(claim.citations);
            const suitable = records.filter((record) => {
                if (record.tool === "listFiles" || (options.tools && !options.tools.includes(record.tool)))
                    return false;
                if (options.scoped && record.target !== target) return false;
                if (!options.source) return true;
                if (["readFile", "search", "searchDependency"].includes(record.tool)) return true;
                const request = z
                    .object({ path: z.string().optional(), url: z.string().optional(), view: z.string().optional() })
                    .passthrough()
                    .safeParse(record.input);
                if (!request.success) return false;
                if (["readDependency", "readGitHubSource"].includes(record.tool)) return !!request.data.path;
                return (
                    record.tool === "readGitHubReference" &&
                    (!!request.data.url?.match(/\/(?:commit|blob)\//) || request.data.view === "files")
                );
            });
            return suitable.length > 0 && records.length === claim.citations.length;
        };
        const claims = {
            advisory: support(proposed.advisory, { tools: ["readAdvisory", "readReference", "readGitHubReference"] }),
            dependencyPath: support(proposed.dependencyPath, {
                scoped: true,
                tools: ["readFile", "dependencyPaths", "readProductArtifact"],
            }),
            affectedBehavior: support(proposed.affectedBehavior, { source: true }),
            callerTrace: support(proposed.callerTrace, { scoped: true, source: true }),
            packaging: support(proposed.packaging, { scoped: true, tools: ["readFile", "readProductArtifact"] }),
        };
        const observedVersions = (record: EvidenceRecord): string[] => {
            if (record.target !== target || record.availability === "unavailable") return [];
            try {
                const value: unknown = JSON.parse(record.output);
                if (record.tool === "dependencyPaths") {
                    const graph = z
                        .object({
                            occurrences: z.array(z.object({ name: z.string(), version: z.string().optional() })),
                        })
                        .parse(value);
                    return graph.occurrences
                        .filter((node) => node.name === proposed.packageName)
                        .flatMap((node) => (node.version ? [node.version] : []));
                }
                if (record.tool === "readProductArtifact") {
                    const artifact = z
                        .object({ manifest: z.object({ name: z.string(), version: z.string() }) })
                        .parse(value);
                    return artifact.manifest.name === proposed.packageName ? [artifact.manifest.version] : [];
                }
            } catch {
                return [];
            }
            return [];
        };
        const versionChecks = proposed.resolvedVersions.map((version) => {
            const records = citations(version.citations);
            return (
                !!valid(version.version) &&
                records.length === version.citations.length &&
                records.some((record) => observedVersions(record).includes(version.version))
            );
        });
        const versionsSupported = versionChecks.length > 0 && versionChecks.every(Boolean);
        // Machine-observed versions from target-scoped graph/artifact records are decisive for
        // version evaluation; the model's resolvedVersions list is only required to cover them
        // (enforced by the observed-version coverage check below), extra informational rows in
        // the list do not weaken an exclusion the graph data proves.
        const machineVersions = [...new Set(evidence.flatMap((record) => observedVersions(record)))].filter((version) =>
            valid(version)
        );
        const prerequisites = proposed.prerequisites.map((item) => ({
            status: item.status,
            supported: support(item.evidence, { scoped: true }),
        }));
        const exclusionSupported = proposed.exclusion
            ? support(proposed.exclusion.evidence, {
                  scoped: true,
                  tools: ["readFile", "readProductArtifact", "dependencyPaths"],
              }) &&
              citations(proposed.exclusion.evidence.citations).every((record) => record.availability === "retrieved")
            : false;
        // The stated range is model-written text and often carries prose after the comparators;
        // parse it leniently and treat the retrieved advisory range as the authority for version math.
        const range = ((): ReturnType<typeof validRange> => {
            const cleaned = proposed.affectedRange.trim().replaceAll(",", " ");
            if (!cleaned) return null;
            const direct = validRange(cleaned);
            if (direct) return direct;
            const prefix = cleaned.split(/[(;\n]/, 1)[0]?.trim() ?? "";
            return prefix ? validRange(prefix) : null;
        })();
        const observedRanges: string[] = [];
        let unsupportedRange = false;
        for (const record of citations(proposed.advisory.citations)) {
            if (!["readAdvisory", "readGitHubReference", "readReference"].includes(record.tool)) continue;
            // Supplemental NVD/CVE records carry a normalized affectedRanges line computed from the
            // record's CNA version data, so paged reads still provide machine-readable bounds.
            const marker = /(?:^|\n)affectedRanges: (\[.*\])(?=\n|$)/.exec(record.output);
            if (marker?.[1]) {
                try {
                    const ranges = z
                        .array(z.object({ package: z.string(), range: z.string() }))
                        .parse(JSON.parse(marker[1]));
                    for (const entry of ranges.filter((item) => item.package === proposed.packageName)) {
                        const normalized = validRange(entry.range.replaceAll(",", " "));
                        if (normalized) observedRanges.push(normalized);
                        else unsupportedRange = true;
                    }
                } catch {
                    // Fall through to the advisory-record shape.
                }
            }
            if (!["readAdvisory", "readGitHubReference"].includes(record.tool)) continue;
            try {
                const advisory = z
                    .object({
                        advisories: z.array(
                            z.object({
                                withdrawn_at: z.string().nullable(),
                                vulnerabilities: z.array(
                                    z.object({
                                        package: z.object({ name: z.string(), ecosystem: z.string() }),
                                        vulnerable_version_range: z.string(),
                                    })
                                ),
                            })
                        ),
                    })
                    .parse(JSON.parse(record.output));
                for (const item of advisory.advisories.filter((item) => item.withdrawn_at === null)) {
                    for (const affected of item.vulnerabilities.filter(
                        (item) => item.package.ecosystem === "npm" && item.package.name === proposed.packageName
                    )) {
                        const normalized = validRange(affected.vulnerable_version_range.replaceAll(",", " "));
                        if (normalized) observedRanges.push(normalized);
                        else unsupportedRange = true;
                    }
                }
            } catch {
                continue;
            }
        }
        const observedRange = observedRanges.length ? observedRanges.join(" || ") : null;
        // Version applicability is evaluated against the retrieved advisory range when available.
        // The model's stated range is audit text only; it is not rendered and never blocks a
        // verdict that retrieved advisory data and graph-observed versions already ground.
        const evaluationRange = observedRange ?? range;
        const matchingVersions =
            evaluationRange &&
            proposed.resolvedVersions.some(
                (version) => valid(version.version) && satisfies(version.version, evaluationRange)
            );
        const allVersionsUnaffected =
            evaluationRange &&
            machineVersions.length > 0 &&
            machineVersions.every(
                (version) =>
                    !satisfies(version, evaluationRange) &&
                    !satisfies(version, evaluationRange, { includePrerelease: true })
            );
        if (proposed.recommendation === "needs-investigation") {
            for (const missing of proposed.missingEvidence) checks.add(`Unresolved evidence: ${missing}`);
            for (const [field, supported] of Object.entries(claims))
                if (!supported) checks.add(`Missing cited ${field} evidence`);
            if (!proposed.missingEvidence.length)
                checks.add("Needs-investigation must identify concrete blocking evidence gaps");
        }
        if (proposed.recommendation !== "needs-investigation") {
            for (const missing of proposed.missingEvidence) checks.add(`Unresolved evidence: ${missing}`);
            if (!claims.advisory) checks.add("Advisory applicability needs cited evidence");
            if (!claims.packaging) checks.add("Target-specific packaging evidence is missing");
            if (proposed.recommendation === "likely-affected" || proposed.exclusion?.basis === "unaffected-version") {
                if (unsupportedRange)
                    checks.add(
                        "A matching non-withdrawn npm advisory range could not be parsed; affected-version coverage is incomplete"
                    );
                if (!observedRange)
                    checks.add(
                        "The affected version range could not be verified against retrieved non-withdrawn npm advisory data for this package"
                    );
            }
            if (proposed.recommendation === "likely-affected") {
                if (!versionsSupported)
                    checks.add("Reported versions are not established by cited target graph/artifact data");
                if (!versionsSupported || !matchingVersions)
                    checks.add("Resolved versions and affected range do not support likely impact");
                for (const field of ["dependencyPath", "affectedBehavior", "callerTrace"] as const)
                    if (!claims[field]) checks.add(`Missing cited ${field} evidence`);
                if (!prerequisites.length || prerequisites.some((item) => item.status !== "met" || !item.supported))
                    checks.add("Exploitation prerequisites are not all established");
            } else {
                if (!proposed.exclusion || !exclusionSupported)
                    checks.add("A concrete, target-specific exclusion is required");
                if (proposed.exclusion?.basis === "unaffected-version" && !allVersionsUnaffected)
                    checks.add("Not all graph-resolved versions are outside the retrieved affected range");
                if (proposed.exclusion?.basis === "unaffected-version") {
                    let productCovered = false;
                    for (const record of evidence.filter(
                        (item) => item.target === target && item.tool === "dependencyPaths"
                    )) {
                        const request = z.object({ name: z.string() }).passthrough().safeParse(record.input);
                        if (!request.success || request.data.name !== proposed.packageName) continue;
                        const occurrenceSchema = z.object({ name: z.string(), version: z.string().optional() });
                        let graph: {
                            resolutionComplete: boolean;
                            occurrences: z.infer<typeof occurrenceSchema>[];
                            productCoverage?: {
                                importer: string;
                                resolutionComplete: boolean;
                                occurrences: z.infer<typeof occurrenceSchema>[];
                            };
                        };
                        try {
                            graph = z
                                .object({
                                    resolutionComplete: z.boolean(),
                                    occurrences: z.array(occurrenceSchema),
                                    productCoverage: z
                                        .object({
                                            importer: z.string().min(1),
                                            resolutionComplete: z.boolean(),
                                            occurrences: z.array(occurrenceSchema),
                                        })
                                        .optional(),
                                })
                                .parse(JSON.parse(record.output));
                        } catch {
                            checks.add(
                                "The observed dependency graph is incomplete or unreadable; version coverage needs review"
                            );
                            continue;
                        }
                        if (!graph.resolutionComplete)
                            checks.add("Observed dependency graph has unresolved edges; version coverage needs review");
                        if (graph.productCoverage?.resolutionComplete) productCovered = true;
                        if (graph.productCoverage && !graph.productCoverage.resolutionComplete)
                            checks.add(
                                "Product-root dependency graph has unresolved edges; version coverage needs review"
                            );
                        for (const occurrence of [
                            ...graph.occurrences,
                            ...(graph.productCoverage?.occurrences ?? []),
                        ].filter((node) => node.name === proposed.packageName)) {
                            if (
                                !occurrence.version ||
                                !proposed.resolvedVersions.some((version) => version.version === occurrence.version)
                            )
                                checks.add(
                                    `Observed version omitted from assessment: ${occurrence.version ?? "unknown"}`
                                );
                        }
                    }
                    if (!productCovered)
                        checks.add("Complete harness-derived product-root version coverage is required");
                }
                if (
                    ["unreachable-behavior", "prerequisite-not-met"].includes(proposed.exclusion?.basis ?? "") &&
                    (!claims.affectedBehavior || !claims.callerTrace || !claims.dependencyPath)
                )
                    checks.add("The behavior exclusion lacks a cited dependency and caller trace");
                if (
                    proposed.exclusion?.basis === "prerequisite-not-met" &&
                    !prerequisites.some((item) => item.status === "not-met" && item.supported)
                )
                    checks.add("No exploitation prerequisite is established as unmet");
            }
        }
        return {
            assessment: proposed,
            recommendation: checks.size ? "needs-investigation" : proposed.recommendation,
            checks: [...checks],
        };
    };
    return {
        summary: assessment.summary,
        humanDecisionRequired: true,
        targets: { release: check("release"), main: check("main") },
    };
}

function plain(value: string): string {
    return value
        .replace(/[\r\n\u2028\u2029]+/g, " ")
        .replace(/[\\{}[\]*_~^|#!+?-]/g, "\\$&")
        .replace(/^(\s*(?:h[1-6]|bq|p|bc|pre|notextile))\./, "$1\\.");
}

// The reader must be able to see which exact targets were assessed; full commits keep the
// line machine-parseable for future cache decisions.
export function renderAssessedTargets(scope: InvestigationScope | null, ticketCreated?: string): string {
    const created = ticketCreated ? ` Ticket created ${plain(ticketCreated.slice(0, 10))}.` : "";
    if (!scope) return `Assessed targets: unknown; no structured target identities recorded.${created}`;
    const release = scope.release
        ? `released product ${plain(scope.release.name)}@${plain(scope.release.version)} (commit ${scope.release.commit})`
        : "released product not assessed";
    return `Assessed targets: current main commit ${scope.main.commit}; ${release}.${created}`;
}

type RenderOptions = {
    evidence?: EvidenceRecord[];
    scope?: InvestigationScope | null;
    ticketCreated?: string;
};

function renderReport(report: CheckedAssessment, options: RenderOptions & { targets: ("release" | "main")[] }): string {
    const evidence = options.evidence ?? [];
    const sections = options.targets.map((target) => {
        const result = report.targets[target];
        const assessment = result.assessment;
        const verdict = {
            "likely-affected": "likely affected",
            "likely-not-affected": "likely not affected",
            "needs-investigation": "could not determine whether we are affected",
        }[result.recommendation];
        const confidence =
            result.recommendation === "needs-investigation"
                ? "low"
                : assessment.exclusion?.basis === "unaffected-version"
                  ? "high"
                  : "moderate";
        const explanation =
            result.recommendation === assessment.recommendation
                ? assessment.summary
                : assessment.missingEvidence[0]
                  ? `The proposed conclusion could not be verified. ${assessment.missingEvidence[0]}`
                  : result.checks.some((check) => check.startsWith("Invalid, unavailable"))
                    ? "The proposed conclusion relied on unavailable, ambiguous or wrong-target citations."
                    : result.checks.includes("Advisory applicability needs cited evidence")
                      ? "The affected version range was not supported by a retrieved advisory."
                      : result.checks.includes("Target-specific packaging evidence is missing")
                        ? "The evidence did not establish this target's shipped contents."
                        : result.checks.includes("A concrete, target-specific exclusion is required")
                          ? "The proposed exclusion was not verified against cited target-specific evidence."
                          : result.checks.some(
                                  (check) =>
                                      check.startsWith("Not all graph-resolved versions") ||
                                      check.startsWith("The affected version range could not be verified")
                              )
                            ? "The established versions could not be verified against the retrieved advisory's affected range."
                            : "The retrieved evidence did not establish the affected version, a reachable vulnerable behavior or a supported exclusion.";
        // The grounding basis lets later runs decide whether a stale fingerprint can be
        // soundly kept without inference: version-grounded verdicts are graph-decidable.
        const grounding =
            result.recommendation === "needs-investigation"
                ? null
                : (assessment.exclusion?.basis ?? "affected-version");
        return [
            `*${target === "release" ? "Released product" : "Current main"}: ${verdict}.*`,
            `Confidence: ${confidence}.`,
            ...(grounding ? [`Grounding: ${grounding}.`] : []),
            plain(explanation),
        ].join(" ");
    });
    const cited = new Set(
        options.targets.flatMap((target) => {
            const assessment = report.targets[target].assessment;
            return [
                assessment.advisory,
                assessment.dependencyPath,
                assessment.affectedBehavior,
                assessment.callerTrace,
                assessment.packaging,
                ...assessment.prerequisites.map((item) => item.evidence),
                ...(assessment.exclusion ? [assessment.exclusion.evidence] : []),
                ...assessment.resolvedVersions,
            ].flatMap((claim) => claim.citations.map((citation) => citation.evidenceId));
        })
    );
    const relevant = evidence.filter((record) => cited.has(record.id));
    const unavailable = relevant.filter((record) => record.availability === "unavailable").length;
    const limited = relevant.filter((record) => record.availability === "limited").length;
    return (
        [
            ...sections,
            ...(unavailable || limited
                ? [
                      `Cited evidence limitations: ${unavailable} unavailable or rejected results; ${limited} incomplete results. Reasons and recovery details are in the dry-run evidence record.`,
                  ]
                : []),
            ...(options.scope !== undefined ? [renderAssessedTargets(options.scope, options.ticketCreated)] : []),
        ].join("\n\n") + " Recommendation only; final decision remains with the reviewer."
    );
}

export function renderAssessment(report: CheckedAssessment, options: RenderOptions = {}): string {
    return renderReport(report, { ...options, targets: ["release", "main"] });
}

// Per-target comment body: the release and main findings are cached as separate Jira comments
// so that a change to one target does not churn the other.
export function renderTargetComment(
    report: CheckedAssessment,
    options: RenderOptions & { target: "release" | "main" }
): string {
    return renderReport(report, { ...options, targets: [options.target] });
}
