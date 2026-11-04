import { createHash } from "node:crypto";
import { satisfies, subset, valid, validRange } from "semver";
import { z } from "zod/v4";
import { diagnoseFailure } from "./triageDiagnostics.js";

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
        nextSteps: z.array(textSchema).min(1).max(12),
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
export type InvestigationResult = { body: string; assessment: CheckedAssessment; evidence: EvidenceRecord[] };

export const ASSESSMENT_INSTRUCTIONS =
    "Return ONLY a JSON object matching the following schema, without Markdown fences or prose outside JSON. This is advisory investigation for a human decision, never an authorization to close, accept risk, or remediate a ticket. Cite actual tool-call IDs as evidenceId and use locator for the exact file:line range or reference section inspected. Never invent IDs, versions, call paths, or exclusions. Ground resolvedVersions in cited dependencyPaths occurrences or the matching product artifact manifest; source text alone is not machine-verified resolution. For version-based recommendations cite readAdvisory or a GitHub advisory reference containing non-withdrawn npm vulnerability records for this package, and use the union of their affected ranges without guessing. List unresolved blocking questions in missingEvidence; nonblocking caveats belong in limitations. Use needs-investigation when support is missing. For unknown claims provide a candid explanation and empty citations; affectedRange may be empty and exclusion null. nextSteps must give concrete human follow-up, including validation of any proposed upgrade. Assess release and main independently.\n" +
    JSON.stringify(z.toJSONSchema(assessmentSchema));

export function evidenceRecord(input: { id: string; tool: string; input: unknown; output: string }): EvidenceRecord {
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
        !input.output.trim() ||
        /(?:^|\n)(?:No |Not an allowed|Too many|(?:Repository|External evidence) context budget exhausted)/i.test(
            input.output.trim()
        );
    const limited = /\[TRUNCATED|"resolutionComplete":\s*false|"pathsTruncated":\s*true|"truncated":\s*true/i.test(
        input.output
    );
    return {
        ...input,
        target,
        sha256: createHash("sha256").update(input.output).digest("hex"),
        availability: unavailable ? "unavailable" : limited ? "limited" : "retrieved",
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
            const failure = diagnoseFailure(
                step.content?.find((part) => part.type === "tool-error" && part.toolCallId === call.toolCallId)?.error
            );
            return evidenceRecord({
                id: call.toolCallId,
                tool: call.toolName,
                input: entry?.input ?? call.input,
                output: entry
                    ? typeof entry.output === "string"
                        ? entry.output
                        : (JSON.stringify(entry.output) ?? "")
                    : `No successful tool result returned; ${failure.category}: ${failure.guidance}`,
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
        investigation: { assessment, evidence },
        body:
            "OFFLINE REPLAY: saved evidence only; sources and release mappings have NOT been refreshed. No Jira write is proposed.\n\n" +
            renderAssessment(assessment, evidence),
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
        const prerequisites = proposed.prerequisites.map((item) => ({
            status: item.status,
            supported: support(item.evidence, { scoped: true }),
        }));
        const exclusionSupported = proposed.exclusion
            ? support(proposed.exclusion.evidence, { scoped: true, tools: ["readFile", "readProductArtifact"] }) &&
              citations(proposed.exclusion.evidence.citations).every((record) => record.availability === "retrieved")
            : false;
        const range = proposed.affectedRange.trim() ? validRange(proposed.affectedRange.replaceAll(",", " ")) : null;
        const observedRanges: string[] = [];
        for (const record of citations(proposed.advisory.citations)) {
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
                    }
                }
            } catch {
                continue;
            }
        }
        const observedRange = observedRanges.length ? observedRanges.join(" || ") : null;
        const rangeVerified =
            !!range && !!observedRange && subset(range, observedRange) && subset(observedRange, range);
        const matchingVersions =
            range &&
            proposed.resolvedVersions.some((version) => valid(version.version) && satisfies(version.version, range));
        const allVersionsUnaffected =
            range &&
            proposed.resolvedVersions.length > 0 &&
            proposed.resolvedVersions.every((version) => valid(version.version) && !satisfies(version.version, range));
        if (proposed.recommendation !== "needs-investigation") {
            for (const missing of proposed.missingEvidence) checks.add(`Unresolved evidence: ${missing}`);
            if (!claims.advisory) checks.add("Advisory applicability needs cited evidence");
            if (!claims.packaging) checks.add("Target-specific packaging evidence is missing");
            if (proposed.recommendation === "likely-affected" || proposed.exclusion?.basis === "unaffected-version") {
                if (!versionsSupported)
                    checks.add("Reported versions are not established by cited target graph/artifact data");
                if (!rangeVerified)
                    checks.add(
                        "The supplied affected range does not match retrieved non-withdrawn npm advisory data for this package"
                    );
            }
            if (proposed.recommendation === "likely-affected") {
                if (!versionsSupported || !matchingVersions)
                    checks.add("Resolved versions and affected range do not support likely impact");
                for (const field of ["dependencyPath", "affectedBehavior", "callerTrace"] as const)
                    if (!claims[field]) checks.add(`Missing cited ${field} evidence`);
                if (!prerequisites.length || prerequisites.some((item) => item.status !== "met" || !item.supported))
                    checks.add("Exploitation prerequisites are not all established");
            } else {
                if (!proposed.exclusion || !exclusionSupported)
                    checks.add("A concrete, target-specific exclusion is required");
                if (
                    proposed.exclusion?.basis === "unaffected-version" &&
                    (!versionsSupported || !allVersionsUnaffected)
                )
                    checks.add("Not all established versions are outside the supplied affected range");
                if (proposed.exclusion?.basis === "unaffected-version") {
                    for (const record of evidence.filter(
                        (item) => item.target === target && item.tool === "dependencyPaths"
                    )) {
                        const request = z.object({ name: z.string() }).passthrough().safeParse(record.input);
                        if (!request.success || request.data.name !== proposed.packageName) continue;
                        let graph: { resolutionComplete: boolean; occurrences: { name: string; version?: string }[] };
                        try {
                            graph = z
                                .object({
                                    resolutionComplete: z.boolean(),
                                    occurrences: z.array(
                                        z.object({ name: z.string(), version: z.string().optional() })
                                    ),
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
                        for (const occurrence of graph.occurrences.filter(
                            (node) => node.name === proposed.packageName
                        )) {
                            if (
                                !occurrence.version ||
                                !proposed.resolvedVersions.some((version) => version.version === occurrence.version)
                            )
                                checks.add(
                                    `Observed version omitted from assessment: ${occurrence.version ?? "unknown"}`
                                );
                        }
                    }
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

export function renderAssessment(report: CheckedAssessment, evidence: EvidenceRecord[] = []): string {
    const claim = (label: string, value: z.infer<typeof claimSchema>): string =>
        `${label}: ${value.text}${value.citations.length ? " " + value.citations.map((citation) => `[${citation.evidenceId}] ${citation.locator}`).join("; ") : " [no supporting citation]"}`;
    const sections = (["release", "main"] as const).map((target) => {
        const result = report.targets[target];
        const assessment = result.assessment;
        return [
            `h2. ${target === "release" ? "Released product" : "Current main"}`,
            `Provisional recommendation: ${result.recommendation}. Human decision required.`,
            ...(result.recommendation !== assessment.recommendation
                ? [`Model proposed: ${assessment.recommendation}; evidence checks require further investigation.`]
                : []),
            assessment.summary,
            `Package: ${assessment.packageName}; versions: ${assessment.resolvedVersions.map((version) => version.version).join(", ") || "unknown"}; supplied advisory range: ${assessment.affectedRange || "unknown"}.`,
            ...assessment.resolvedVersions.map((version) =>
                claim(`Version ${version.version}`, { text: "Resolution evidence", citations: version.citations })
            ),
            claim("Advisory", assessment.advisory),
            claim("Dependency path", assessment.dependencyPath),
            claim("Affected behavior", assessment.affectedBehavior),
            claim("Caller trace", assessment.callerTrace),
            claim("Packaging", assessment.packaging),
            ...assessment.prerequisites.map((item) =>
                claim(`Prerequisite (${item.status}): ${item.condition}`, item.evidence)
            ),
            ...(assessment.exclusion
                ? [claim(`Proposed exclusion (${assessment.exclusion.basis})`, assessment.exclusion.evidence)]
                : []),
            "h3. Missing evidence and checks",
            ...([...assessment.missingEvidence, ...result.checks].length
                ? [...assessment.missingEvidence, ...result.checks].map((item) => `* ${item}`)
                : ["* No blocking gaps recorded by these checks; human verification is still required."]),
            ...assessment.limitations.map((item) => `* Limitation: ${item}`),
            "h3. Recommended follow-up",
            ...assessment.nextSteps.map((item) => `* ${item}`),
        ].join("\n");
    });
    const cited = new Set<string>();
    for (const target of [report.targets.release.assessment, report.targets.main.assessment]) {
        const claims = [
            target.advisory,
            target.dependencyPath,
            target.affectedBehavior,
            target.callerTrace,
            target.packaging,
            ...target.prerequisites.map((item) => item.evidence),
            ...(target.exclusion ? [target.exclusion.evidence] : []),
            ...target.resolvedVersions,
        ];
        for (const value of claims) for (const citation of value.citations) cited.add(citation.evidenceId);
    }
    const index = evidence
        .filter((record) => cited.has(record.id))
        .map(
            (record) =>
                `* [${record.id}] ${record.tool}; target=${record.target ?? "external"}; ${JSON.stringify(record.input)}; ${record.availability}; SHA-256=${record.sha256}`
        )
        .join("\n");
    return [
        "h1. Investigation and recommendation",
        "Advisory only. A human must decide the final disposition; no closure, risk acceptance, remediation or ticket status change is authorized.",
        "Evidence checks validate structure, retrieved citation IDs, target scope and supplied semver consistency, not whether cited text proves a claim. Recommendations remain provisional.",
        report.summary,
        ...sections,
        "h2. Evidence index",
        index || "No retrieved evidence cited. Inspect the missing evidence and recommended follow-up.",
        "The dry-run JSONL includes the full returned evidence ledger. Tool errors are not successful evidence.",
    ].join("\n\n");
}
