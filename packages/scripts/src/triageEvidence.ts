import { createHash, timingSafeEqual } from "node:crypto";
import { buffer } from "node:stream/consumers";
import { gunzipSync } from "node:zlib";
import { extract } from "tar-stream";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { z } from "zod/v4";
import { setTimeout as delay } from "node:timers/promises";
import { rcompare, valid, validRange } from "semver";

const MAX_FILE_BYTES = 1024 * 1024;

export class EvidenceHttpError extends Error {
    readonly status: number;
    readonly rateLimited: boolean;

    constructor(input: { status: number; rateLimited: boolean }) {
        super(`External evidence unavailable (HTTP ${input.status})`);
        this.name = "EvidenceHttpError";
        this.status = input.status;
        this.rateLimited = input.rateLimited;
    }
}

export const evidenceLimitsSchema = z.object({
    requests: z.number().int().min(1).max(2000).default(200),
    contextCharacters: z.number().int().min(16_000).max(2_000_000).default(200_000),
    archiveBytes: z
        .number()
        .int()
        .min(1024 * 1024)
        .max(1024 * 1024 * 1024)
        .default(128 * 1024 * 1024),
    downloadBytes: z
        .number()
        .int()
        .min(1024 * 1024)
        .max(1024 * 1024 * 1024)
        .default(256 * 1024 * 1024),
    responseBytes: z
        .number()
        .int()
        .min(1024)
        .max(50 * 1024 * 1024)
        .default(20 * 1024 * 1024),
});
export type EvidenceLimits = z.infer<typeof evidenceLimitsSchema>;
export const advisoryReadOptionsSchema = z.object({
    descriptionOffset: z.number().int().min(0).default(0),
    descriptionCharacters: z.number().int().min(1).max(4000).default(1000),
    referenceOffset: z.number().int().min(0).default(0),
    referenceLimit: z.number().int().min(1).max(50).default(10),
});
type PackageArchive = {
    files: Map<string, string>;
    entries: { path: string; type: string; bytes: number; readable: boolean }[];
    source: string;
    tarball: string;
    integrity: string;
};

const publicReportPaths: Record<string, RegExp> = {
    "cwe.mitre.org": /^\/data\/definitions\/\d+\.html$/,
    "security.snyk.io": /^\/vuln\/SNYK-[A-Z0-9-]+$/,
    "www.vulncheck.com": /^\/advisories\/[a-z0-9-]+\/?$/,
    "www.codeant.ai": /^\/security-research\/[a-z0-9-]+\/?$/,
    "access.redhat.com": /^\/security\/cve\/CVE-\d{4}-\d+$/i,
    "security.access.redhat.com": /^\/data\/csaf\/v2\/vex\/\d{4}\/cve-\d{4}-\d+\.json$/i,
    "bugzilla.redhat.com": /^\/show_bug\.cgi$/,
    "cna.openjsf.org": /^\/security-advisories\.html$/,
    "vuldb.com": /^\/(?:submit|vuln)\/\d+(?:\/cti)?$/,
};
export type EvidenceOptions = {
    kondukto?: { url: string; token: string };
    exports?: { url: string; evidence: unknown }[];
    limits?: Partial<EvidenceLimits>;
    signal?: AbortSignal;
    /** Bearer token sent only to api.github.com; raises the anonymous rate limit for advisory/source reads. */
    githubToken?: string;
};

const packageSchema = z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
const npmCatalogSchema = z
    .object({
        versions: z.record(z.string(), z.unknown()).optional(),
        "dist-tags": z.record(z.string(), z.string()).default({}),
        time: z
            .object({
                unpublished: z
                    .object({ time: z.string().optional(), versions: z.array(z.string()).optional() })
                    .optional(),
            })
            .optional(),
    })
    .refine(
        (value) => value.versions !== undefined || value.time?.unpublished !== undefined,
        "npm catalog must contain versions or an explicit unpublish record"
    );
const githubTreeSchema = z.object({
    truncated: z.boolean(),
    tree: z.array(
        z.object({
            path: z.string(),
            mode: z.string(),
            type: z.string(),
            sha: z.string().regex(/^[a-f0-9]{40}$/i),
            size: z.number().int().nonnegative().optional(),
        })
    ),
});
const advisoryRecordSchema = z.object({
    ghsa_id: z.string(),
    cve_id: z.string().nullable(),
    html_url: z.string(),
    summary: z.string(),
    description: z.string(),
    updated_at: z.string(),
    withdrawn_at: z.string().nullable(),
    vulnerabilities: z.array(
        z.object({
            package: z.object({ ecosystem: z.string(), name: z.string() }),
            vulnerable_version_range: z.string(),
            first_patched_version: z.string().nullable(),
        })
    ),
    references: z.array(z.string()),
});

const cveVersionEntrySchema = z
    .object({
        version: z.string().max(100),
        lessThan: z.string().max(100).optional(),
        lessThanOrEqual: z.string().max(100).optional(),
        status: z.string().max(50).optional(),
        versionType: z.string().max(50).optional(),
    })
    .passthrough();
const cveAffectedEntrySchema = z
    .object({
        vendor: z.string().max(200).optional(),
        product: z.string().max(200).optional(),
        packageURL: z.string().max(500).optional(),
        versions: z.array(cveVersionEntrySchema).optional(),
        affectedData: z
            .array(
                z
                    .object({
                        vendor: z.string().max(200).optional(),
                        product: z.string().max(200).optional(),
                        packageURL: z.string().max(500).optional(),
                        versions: z.array(cveVersionEntrySchema).optional(),
                    })
                    .passthrough()
            )
            .optional(),
    })
    .passthrough();

// NVD 2.0 records embed the CNA affected list under vulnerabilities[].cve.affected (some with
// affectedData nesting); CVE 5.x records carry containers.cna.affected. Normalize semver version
// entries into npm package ranges so paged supplemental evidence retains machine-readable bounds.
function npmAffectedRanges(record: unknown): { package: string; range: string }[] {
    const entries: z.infer<typeof cveAffectedEntrySchema>[] = [];
    const nvd = z
        .object({
            vulnerabilities: z.array(
                z.object({ cve: z.object({ affected: z.array(cveAffectedEntrySchema).optional() }).passthrough() })
            ),
        })
        .safeParse(record);
    if (nvd.success)
        for (const vulnerability of nvd.data.vulnerabilities) entries.push(...(vulnerability.cve.affected ?? []));
    const cve5 = z
        .object({
            containers: z.object({
                cna: z.object({ affected: z.array(cveAffectedEntrySchema).optional() }).passthrough(),
            }),
        })
        .safeParse(record);
    if (cve5.success) entries.push(...(cve5.data.containers.cna.affected ?? []));
    const ranges: { package: string; range: string }[] = [];
    for (const entry of entries) {
        for (const candidate of [entry, ...(entry.affectedData ?? [])]) {
            const purl = candidate.packageURL?.replace(/^pkg:npm\//, "");
            const at = purl ? purl.lastIndexOf("@") : -1;
            const name = purl
                ? decodeURIComponent(at > 0 ? purl.slice(0, at) : purl)
                : (candidate.product ?? candidate.vendor);
            if (!name) continue;
            for (const version of candidate.versions ?? []) {
                if (version.status && version.status !== "affected") continue;
                if (version.versionType && version.versionType !== "semver") continue;
                const range = version.lessThan
                    ? validRange(
                          version.version === "0"
                              ? `< ${version.lessThan}`
                              : `>= ${version.version} < ${version.lessThan}`
                      )
                    : version.lessThanOrEqual
                      ? validRange(`>= ${version.version} <= ${version.lessThanOrEqual}`)
                      : validRange(version.version);
                if (range && !ranges.some((existing) => existing.package === name && existing.range === range))
                    ranges.push({ package: name, range });
            }
        }
    }
    return ranges;
}

export class TriageEvidence {
    hasAdvisoryEvidence = false;
    hasDependencyEvidence = false;
    hasGitHubEvidence = false;
    hasSupplementalEvidence = false;
    hasArtifactEvidence = false;
    private readonly request: typeof fetch;
    private readonly limits: EvidenceLimits;
    private remainingRequests: number;
    private maxResponseBytes = 0;
    private remainingCharacters: number;
    private remainingArchiveBytes: number;
    private remainingDownloadBytes: number;
    private retries = 0;
    private readonly packages = new Map<string, Promise<PackageArchive>>();
    private readonly catalogs = new Map<string, Promise<z.infer<typeof npmCatalogSchema>>>();
    private readonly githubTrees = new Map<string, z.infer<typeof githubTreeSchema>>();
    private readonly advisoryReads = new Map<string, Promise<z.infer<typeof advisoryRecordSchema>[]>>();
    private readonly options: EvidenceOptions;
    private readonly konduktoOrigin?: string;

    constructor(request: typeof fetch = fetch, options: EvidenceOptions = {}) {
        this.request = request;
        this.options = options;
        this.limits = evidenceLimitsSchema.parse(options.limits ?? {});
        this.remainingRequests = this.limits.requests;
        this.remainingCharacters = this.limits.contextCharacters;
        this.remainingArchiveBytes = this.limits.archiveBytes;
        this.remainingDownloadBytes = this.limits.downloadBytes;
        if (options.kondukto) {
            const origin = new URL(options.kondukto.url);
            if (
                origin.protocol !== "https:" ||
                !origin.hostname.endsWith(".kondukto.io") ||
                origin.port ||
                origin.username ||
                origin.password ||
                origin.search ||
                origin.hash ||
                origin.pathname !== "/"
            )
                throw new Error("KONDUKTO_URL must be an HTTPS Kondukto SaaS origin without credentials or a path");
            this.konduktoOrigin = origin.origin;
        }
    }

    private async download(url: URL, authenticated = false): Promise<Buffer> {
        if (
            url.protocol !== "https:" ||
            url.port ||
            url.username ||
            url.password ||
            url.hash ||
            !(authenticated
                ? url.origin === this.konduktoOrigin && /^\/api\/v2\/vulnerabilities\/[a-f0-9]{24}$/.test(url.pathname)
                : [
                      "api.github.com",
                      "registry.npmjs.org",
                      "services.nvd.nist.gov",
                      "cveawg.mitre.org",
                      ...Object.keys(publicReportPaths),
                  ].includes(url.hostname))
        )
            throw new Error("External evidence URL is not allowed");
        const response = await this.fetchResponse(url, authenticated);
        if (
            Number(response.headers.get("content-length")) >
            Math.min(this.limits.responseBytes, this.remainingDownloadBytes)
        ) {
            await response.body?.cancel();
            throw new Error("External evidence exceeds download budget");
        }
        if (!response.body) throw new Error("Empty external evidence response");
        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let length = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                length += value.byteLength;
                this.maxResponseBytes = Math.max(this.maxResponseBytes, length);
                this.remainingDownloadBytes -= value.byteLength;
                if (length > this.limits.responseBytes || this.remainingDownloadBytes < 0)
                    throw new Error("External evidence exceeds download budget");
                chunks.push(Buffer.from(value));
            }
        } finally {
            await reader.cancel();
        }
        return Buffer.concat(chunks);
    }

    private async fetchResponse(url: URL, authenticated: boolean): Promise<Response> {
        for (let attempt = 0; ; attempt++) {
            this.options.signal?.throwIfAborted();
            if (this.remainingRequests <= 0) throw new Error("External evidence request budget exhausted");
            if (this.remainingDownloadBytes <= 0) throw new Error("External evidence total download budget exhausted");
            this.remainingRequests--;
            if (attempt) this.retries++;
            let response: Response;
            try {
                response = await this.request(url, {
                    method: "GET",
                    redirect: "error",
                    headers: {
                        Accept: "application/json, text/html;q=0.9",
                        "User-Agent": "mongodb-vulnerability-auto-triage",
                        ...(authenticated && this.options.kondukto ? { "X-Cookie": this.options.kondukto.token } : {}),
                        ...(url.hostname === "api.github.com" && this.options.githubToken
                            ? { Authorization: `Bearer ${this.options.githubToken}` }
                            : {}),
                    },
                    signal: this.options.signal
                        ? AbortSignal.any([this.options.signal, AbortSignal.timeout(20_000)])
                        : AbortSignal.timeout(20_000),
                });
            } catch (error) {
                if (
                    authenticated ||
                    attempt >= 2 ||
                    this.options.signal?.aborted ||
                    !(error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError"))
                )
                    throw error;
                if (this.remainingRequests <= 0)
                    throw new Error("External evidence request budget exhausted before retry", { cause: error });
                await delay(500 * 2 ** attempt, undefined, { signal: this.options.signal });
                continue;
            }
            if (response.ok) return response;
            const failure = new EvidenceHttpError({
                status: response.status,
                rateLimited:
                    response.status === 429 ||
                    (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0"),
            });
            await response.body?.cancel();
            if (authenticated || attempt >= 2 || ![429, 502, 503, 504].includes(response.status)) throw failure;
            if (this.remainingRequests <= 0)
                throw new Error("External evidence request budget exhausted before retry", { cause: failure });
            const retryAfter = response.headers.get("retry-after");
            const parsed =
                retryAfter === null
                    ? NaN
                    : /^\d+(?:\.\d+)?$/.test(retryAfter.trim())
                      ? Number(retryAfter) * 1000
                      : Date.parse(retryAfter) - Date.now();
            const milliseconds = Number.isFinite(parsed) ? Math.max(0, parsed) : 500 * 2 ** attempt;
            if (milliseconds > 30_000) throw failure;
            await delay(milliseconds, undefined, { signal: this.options.signal });
        }
    }

    usage(): {
        requests: number;
        retries: number;
        downloadBytes: number;
        maxResponseBytes: number;
        archiveBytes: number;
        contextCharacters: number;
        limits: EvidenceLimits;
    } {
        return {
            requests: this.limits.requests - this.remainingRequests,
            retries: this.retries,
            downloadBytes: this.limits.downloadBytes - this.remainingDownloadBytes,
            maxResponseBytes: this.maxResponseBytes,
            archiveBytes: this.limits.archiveBytes - this.remainingArchiveBytes,
            contextCharacters: this.limits.contextCharacters - this.remainingCharacters,
            limits: this.limits,
        };
    }

    private bounded(text: string): string {
        const available = Math.min(16_000, this.remainingCharacters);
        if (available <= 0) return "External evidence context budget exhausted; report missing evidence.";
        const result = text.slice(0, available);
        this.remainingCharacters -= result.length;
        return result + (result.length < text.length ? "\n[TRUNCATED; narrow the request]" : "");
    }

    private boundedJson(value: unknown): string {
        const text = JSON.stringify(value);
        const result =
            text.length <= Math.min(16_000, this.remainingCharacters)
                ? text
                : JSON.stringify({
                      truncated: true,
                      limitations: [
                          "Structured evidence exceeds remaining context budget; request narrower evidence. No complete facts returned.",
                      ],
                  });
        this.remainingCharacters = Math.max(0, this.remainingCharacters - result.length);
        return result;
    }

    async reference(input: { url: string; startLine?: number; lineCount?: number }): Promise<string> {
        const url = new URL(input.url);
        if (url.protocol !== "https:" || url.port || url.username || url.password)
            throw new Error("Evidence references require HTTPS without credentials or ports");
        if (["github.com", "gist.github.com"].includes(url.hostname)) return this.githubReference(input);
        url.hash = "";
        if (url.hostname.endsWith(".kondukto.io")) return this.kondukto(url);
        const cve = /^\/vuln\/detail\/(CVE-\d{4}-\d+)$/i.exec(url.pathname);
        const cveRecord =
            url.hostname === "www.cve.org" &&
            url.pathname === "/CVERecord" &&
            /^CVE-\d{4}-\d+$/i.test(url.searchParams.get("id") ?? "");
        let content: unknown;
        let source = url.href;
        if (url.hostname === "nvd.nist.gov" && cve?.[1] && !url.search) {
            const id = cve[1].toUpperCase();
            source = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${id}`;
            const record = z
                .object({ vulnerabilities: z.array(z.object({ cve: z.object({ id: z.string() }).passthrough() })) })
                .parse(JSON.parse((await this.download(new URL(source))).toString("utf8")));
            if (record.vulnerabilities.some((entry) => entry.cve.id !== id))
                throw new Error("NVD CVE identity mismatch");
            if (!record.vulnerabilities.length) return "No NVD record; missing evidence, not proof of non-impact.";
            content = record;
        } else if (
            cveRecord &&
            [...url.searchParams.keys()].every((key) => key === "id") &&
            url.searchParams.getAll("id").length === 1
        ) {
            const id = (url.searchParams.get("id") ?? "").toUpperCase();
            source = `https://cveawg.mitre.org/api/cve/${id}`;
            const record = z
                .object({ cveMetadata: z.object({ cveId: z.string() }) })
                .passthrough()
                .parse(JSON.parse((await this.download(new URL(source))).toString("utf8")));
            if (record.cveMetadata.cveId !== id) throw new Error("CVE record identity mismatch");
            content = record;
        } else {
            if (!publicReportPaths[url.hostname]?.test(url.pathname))
                throw new Error("Unsupported evidence host or report path");
            if (url.hostname === "bugzilla.redhat.com") {
                if (!/^\?id=\d+$/.test(url.search)) throw new Error("Bugzilla requires a numeric id only");
            } else if (url.search) throw new Error("Report query parameters are not allowed");
            const bytes = await this.download(url);
            content = url.pathname.endsWith(".json")
                ? JSON.parse(bytes.toString("utf8"))
                : reportText(bytes.toString("utf8"), url);
        }
        const start = z
            .number()
            .int()
            .min(1)
            .parse(input.startLine ?? 1);
        const count = z
            .number()
            .int()
            .min(1)
            .max(200)
            .parse(input.lineCount ?? 100);
        // Retain machine-readable affected-version bounds even when the record is read in pages.
        const normalized = typeof content === "string" ? [] : npmAffectedRanges(content);
        const allLines = JSON.stringify(content, null, 2).split("\n");
        const lines = allLines.slice(start - 1, start - 1 + count);
        if (lines.length && this.remainingCharacters > 0) this.hasSupplementalEvidence = true;
        return this.bounded(
            `${source}\nResult range starts at ${start}; ${lines.length} of ${allLines.length} total lines returned. Use startLine to continue.\nUntrusted supplemental context; CWE is general background, and vendor product conclusions do not establish impact in our product. No scripts, assets, payloads, or linked URLs are executed/fetched.\n${normalized.length ? `Normalized from this record's CNA version data (npm packages only):\naffectedRanges: ${JSON.stringify(normalized)}\n` : ""}${lines.map((line, index) => `${start + index}: ${line}`).join("\n")}`
        );
    }

    private async kondukto(url: URL): Promise<string> {
        const projectPath = /^\/projects\/[a-f0-9]{24}\/vulns\/appsec$/.test(url.pathname);
        const groupPath = url.pathname === "/vulnerabilities/appsec";
        if (!projectPath && !groupPath) throw new Error("Unsupported Kondukto finding URL");
        const exported = this.options.exports?.find((record) => new URL(record.url).href === url.href);
        if (exported) {
            if (this.remainingCharacters > 0) this.hasSupplementalEvidence = true;
            return this.bounded(
                JSON.stringify(
                    {
                        source: url.href,
                        origin: "Offline export; may be stale. Independently validate scanner claims.",
                        evidence: exported.evidence,
                    },
                    null,
                    2
                )
            );
        }
        if (!this.options.kondukto || url.origin !== this.konduktoOrigin)
            throw new Error(
                "Kondukto access unavailable: configure matching KONDUKTO_URL/KONDUKTO_TOKEN or provide an exact-URL evidence export"
            );
        const id = /^in:([a-f0-9]{24})$/.exec(url.searchParams.get("id") ?? "")?.[1];
        if (!id || !projectPath)
            throw new Error(
                "Grouped Kondukto references require an offline export or an individual finding URL; no broad unfiltered API search is performed"
            );
        const api = new URL(`/api/v2/vulnerabilities/${id}`, this.konduktoOrigin);
        const record = z
            .object({ data: z.object({ vulnerability: z.object({ id: z.string() }).passthrough() }).passthrough() })
            .parse(JSON.parse((await this.download(api, true)).toString("utf8")));
        if (record.data.vulnerability.id !== id) throw new Error("Kondukto finding identity mismatch");
        if (this.remainingCharacters > 0) this.hasSupplementalEvidence = true;
        return this.bounded(
            JSON.stringify(
                {
                    source: url.href,
                    apiSource: api.href,
                    evidence: record,
                    limitations:
                        "Scanner context, not proof of reachability or release impact. Branch metadata is unverified.",
                },
                null,
                2
            )
        );
    }

    async latestRelease(
        name: string
    ): Promise<{ name: string; version: string; gitHead?: string; source: string; repository?: string }> {
        packageSchema.parse(name);
        const url = new URL(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
        const metadata = z
            .object({
                name: z.string(),
                version: versionSchema,
                gitHead: z
                    .string()
                    .regex(/^[a-f0-9]{40}$/i)
                    .optional(),
                dist: z
                    .object({ integrity: z.string(), attestations: z.object({ url: z.string() }).optional() })
                    .optional(),
            })
            .parse(JSON.parse((await this.download(url)).toString("utf8")));
        if (metadata.name !== name) throw new Error("Registry release package identity mismatch");
        if (!metadata.gitHead && metadata.dist?.attestations) {
            const provenanceUrl = new URL(
                `https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent(name)}@${metadata.version}`
            );
            const attestations = z
                .object({
                    attestations: z.array(
                        z.object({
                            predicateType: z.string(),
                            bundle: z.object({ dsseEnvelope: z.object({ payload: z.string() }) }),
                        })
                    ),
                })
                .parse(JSON.parse((await this.download(provenanceUrl)).toString("utf8")));
            const matches = attestations.attestations.filter(
                (item) => item.predicateType === "https://slsa.dev/provenance/v1"
            );
            if (matches.length > 1) throw new Error("Ambiguous npm provenance records");
            if (matches[0]) {
                const statement = z
                    .object({
                        subject: z.array(z.object({ digest: z.object({ sha512: z.string() }) })),
                        predicate: z.object({
                            buildDefinition: z.object({
                                externalParameters: z.object({ workflow: z.object({ repository: z.string() }) }),
                                resolvedDependencies: z.array(
                                    z.object({
                                        uri: z.string(),
                                        digest: z.object({
                                            gitCommit: z
                                                .string()
                                                .regex(/^[a-f0-9]{40}$/i)
                                                .optional(),
                                        }),
                                    })
                                ),
                            }),
                        }),
                    })
                    .parse(JSON.parse(Buffer.from(matches[0].bundle.dsseEnvelope.payload, "base64").toString("utf8")));
                const sri = metadata.dist.integrity.split(/\s+/).find((value) => value.startsWith("sha512-"));
                if (
                    !sri ||
                    !statement.subject.some(
                        (subject) => subject.digest.sha512 === Buffer.from(sri.slice(7), "base64").toString("hex")
                    )
                )
                    throw new Error("npm provenance artifact digest does not match the published package");
                const definition = statement.predicate.buildDefinition;
                const repository = definition.externalParameters.workflow.repository;
                const commits = [
                    ...new Set(
                        definition.resolvedDependencies
                            .filter((item) => item.uri.startsWith(`git+${repository}@`) && item.digest.gitCommit)
                            .flatMap((item) => (item.digest.gitCommit ? [item.digest.gitCommit] : []))
                    ),
                ];
                if (commits.length !== 1) throw new Error("npm provenance does not identify a unique source commit");
                return { name, version: metadata.version, gitHead: commits[0], repository, source: provenanceUrl.href };
            }
        }
        return { name, version: metadata.version, gitHead: metadata.gitHead, source: url.href };
    }

    async releaseTagCommit(repositoryUrl: string, version: string): Promise<string> {
        versionSchema.parse(version);
        const repository = new URL(repositoryUrl.replace(/^git\+/, ""));
        const slug = repository.pathname.replace(/^\//, "").replace(/\.git$/, "");
        if (
            repository.protocol !== "https:" ||
            repository.hostname !== "github.com" ||
            repository.port ||
            repository.username ||
            repository.password ||
            repository.search ||
            repository.hash ||
            !/^[\w.-]+\/[\w.-]+$/.test(slug)
        ) {
            throw new Error("Automatic release tag lookup requires an HTTPS GitHub repository URL; use --release-ref");
        }
        let url = new URL(`https://api.github.com/repos/${slug}/git/ref/tags/v${version}`);
        for (let depth = 0; depth < 5; depth++) {
            const result = z
                .object({
                    object: z.object({ type: z.enum(["commit", "tag"]), sha: z.string().regex(/^[a-f0-9]{40}$/i) }),
                })
                .parse(JSON.parse((await this.download(url)).toString("utf8")));
            if (result.object.type === "commit") return result.object.sha;
            url = new URL(`https://api.github.com/repos/${slug}/git/tags/${result.object.sha}`);
        }
        throw new Error("Release tag nesting limit exceeded");
    }

    async advisory(id: string, input: z.input<typeof advisoryReadOptionsSchema> = {}): Promise<string> {
        const options = advisoryReadOptionsSchema.parse(input);
        const normalized = id.toUpperCase();
        const ghsa = /^GHSA-[23456789CFGHJMPQRVWX]{4}(?:-[23456789CFGHJMPQRVWX]{4}){2}$/;
        const cve = /^CVE-\d{4}-\d{4,}$/;
        if (!ghsa.test(normalized) && !cve.test(normalized))
            throw new Error("Use a GHSA or CVE identifier, not an arbitrary URL");
        const url = ghsa.test(normalized)
            ? new URL(`https://api.github.com/advisories/${normalized.toLowerCase()}`)
            : new URL(`https://api.github.com/advisories?cve_id=${normalized}&per_page=10`);
        return this.advisoryFromUrl(url, options);
    }

    private async advisoryFromUrl(url: URL, options: z.output<typeof advisoryReadOptionsSchema>): Promise<string> {
        let pending = this.advisoryReads.get(url.href);
        if (!pending) {
            pending = this.download(url)
                .then((bytes) => {
                    const json: unknown = JSON.parse(bytes.toString("utf8"));
                    return z.array(advisoryRecordSchema).parse(Array.isArray(json) ? json : [json]);
                })
                .catch((error: unknown) => {
                    this.advisoryReads.delete(url.href);
                    throw error;
                });
            this.advisoryReads.set(url.href, pending);
        }
        const advisories = await pending;
        if (!advisories.length)
            return "No matching GitHub advisory; this is missing evidence, not proof of non-impact.";
        let descriptionCharacters = options.descriptionCharacters;
        let referenceLimit = options.referenceLimit;
        const page = (): { source: string; advisories: unknown[] } => ({
            source: url.href,
            advisories: advisories.map((advisory) => ({
                ...advisory,
                description: advisory.description.slice(
                    options.descriptionOffset,
                    options.descriptionOffset + descriptionCharacters
                ),
                descriptionOffset: options.descriptionOffset,
                descriptionLength: advisory.description.length,
                nextDescriptionOffset:
                    options.descriptionOffset + descriptionCharacters < advisory.description.length
                        ? options.descriptionOffset + descriptionCharacters
                        : null,
                references: advisory.references.slice(
                    options.referenceOffset,
                    options.referenceOffset + referenceLimit
                ),
                referenceOffset: options.referenceOffset,
                referenceCount: advisory.references.length,
                nextReferenceOffset:
                    options.referenceOffset + referenceLimit < advisory.references.length
                        ? options.referenceOffset + referenceLimit
                        : null,
            })),
        });
        let result = page();
        const available = Math.min(16_000, this.remainingCharacters);
        while (JSON.stringify(result).length > available && (descriptionCharacters || referenceLimit)) {
            if (descriptionCharacters) descriptionCharacters = Math.floor(descriptionCharacters / 2);
            else referenceLimit = Math.floor(referenceLimit / 2);
            result = page();
        }
        if (JSON.stringify(result).length <= available) this.hasAdvisoryEvidence = true;
        return this.boundedJson(result);
    }

    async githubReference(input: {
        url: string;
        path?: string;
        page?: number;
        patchOffset?: number;
        view?: "metadata" | "files" | "comments" | "reviews" | "review-comments";
        startLine?: number;
        lineCount?: number;
    }): Promise<string> {
        const reference = new URL(input.url);
        if (reference.hostname === "gist.github.com") return this.gist(input);
        if (
            reference.protocol !== "https:" ||
            reference.hostname !== "github.com" ||
            reference.port ||
            reference.username ||
            reference.password ||
            reference.search
        )
            throw new Error("Use a public HTTPS github.com reference without credentials or query parameters");
        const anchor = /^#L(\d+)(?:-L(\d+))?$/.exec(reference.hash);
        reference.hash = "";
        const parts = reference.pathname.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);
        const [owner, repository, kind, identifier, ...rest] = parts;
        if (
            !owner ||
            !repository ||
            !/^[A-Za-z0-9_-]+$/.test(owner) ||
            !/^[A-Za-z0-9_.-]+$/.test(repository) ||
            repository === "." ||
            repository === ".."
        )
            throw new Error("Invalid GitHub repository");
        const base = `https://api.github.com/repos/${owner}/${repository}`;
        const page = z
            .number()
            .int()
            .min(1)
            .max(10)
            .parse(input.page ?? 1);
        const sha = z.string().regex(/^[a-f0-9]{40}$/i);
        let result: unknown;
        if (kind === "security" && identifier === "advisories" && rest.length === 1 && rest[0]) {
            try {
                return await this.advisory(rest[0]);
            } catch (error) {
                if (!(error instanceof EvidenceHttpError) || error.status !== 404) throw error;
                // Repository-published advisories are not reviewed into the global database;
                // read them through the owning repository's endpoint.
                return this.advisoryFromUrl(
                    new URL(`${base}/security-advisories/${encodeURIComponent(rest[0])}`),
                    advisoryReadOptionsSchema.parse({})
                );
            }
        } else if (kind === "commit" && identifier && /^[a-f0-9]{7,40}$/i.test(identifier) && !rest.length) {
            const url = new URL(`${base}/commits/${identifier}?per_page=100&page=${page}`);
            const commit = z
                .object({
                    sha,
                    commit: z.object({ message: z.string() }),
                    files: z.array(
                        z.object({
                            filename: z.string(),
                            previous_filename: z.string().optional(),
                            status: z.string(),
                            patch: z.string().optional(),
                        })
                    ),
                })
                .parse(JSON.parse((await this.download(url)).toString("utf8")));
            if (
                identifier.length === 40
                    ? commit.sha.toLowerCase() !== identifier.toLowerCase()
                    : !commit.sha.toLowerCase().startsWith(identifier.toLowerCase())
            )
                throw new Error("GitHub commit identity mismatch");
            const selected = commit.files.filter((file) => !input.path || file.filename === input.path);
            const patchOffset = z
                .number()
                .int()
                .min(0)
                .parse(input.patchOffset ?? 0);
            if (patchOffset && !input.path) throw new Error("patchOffset requires an exact path");
            const files = selected.map((file) => ({
                ...file,
                ...(input.path && file.patch
                    ? {
                          patch: file.patch.slice(patchOffset, patchOffset + 8000),
                          patchOffset,
                          nextPatchOffset: patchOffset + 8000 < file.patch.length ? patchOffset + 8000 : null,
                      }
                    : {}),
            }));
            const baseResult = {
                source: reference.href,
                apiSource: url.href,
                commit: commit.sha,
                message: commit.commit.message.slice(0, 2000),
                files,
                page,
                nextPage: commit.files.length === 100 && page < 10 ? page + 1 : null,
                limitations:
                    "GitHub may omit or truncate patches. At most 10 pages are available. Missing files/patches are not proof of non-impact; read source at an exact commit when needed. For a selected path, nextPatchOffset continues patch characters, not source line numbers.",
            };
            if (input.path && files.some((file) => "nextPatchOffset" in file && file.nextPatchOffset !== null)) {
                const output = this.boundedJson({
                    ...baseResult,
                    evidenceStatus: "limited",
                    reason: "The selected patch exceeds the bounded patch page; the returned JSON and patch fragment are intact.",
                    recovery: "Read the same URL and exact path with patchOffset=nextPatchOffset until it is null.",
                });
                if (!z.object({ truncated: z.literal(true) }).safeParse(JSON.parse(output)).success)
                    this.hasGitHubEvidence = true;
                return output;
            }
            if (JSON.stringify(baseResult).length > Math.min(16_000, this.remainingCharacters) && !input.path) {
                const indexed = selected.map(({ patch, ...file }) => ({
                    ...file,
                    patchAvailable: patch !== undefined,
                    patch: undefined as string | undefined,
                    patchOffset: undefined as number | undefined,
                    nextPatchOffset: undefined as number | null | undefined,
                }));
                const compact = {
                    ...baseResult,
                    files: indexed,
                    coverage: "file-index-with-selected-patches",
                    patchesComplete: false,
                    recovery:
                        "Implementation patches are prioritized over snapshots and tests. Select an omitted filename with path, then follow nextPatchOffset as patchOffset. Inspect only patches relevant to the advisory; omitted content is not proof of non-impact.",
                };
                const prioritized = [...selected].sort(
                    (left, right) =>
                        Number(/snapshot|__snapshots__|\.snap|(?:^|\/)tests?\//i.test(left.filename)) -
                        Number(/snapshot|__snapshots__|\.snap|(?:^|\/)tests?\//i.test(right.filename))
                );
                for (const file of prioritized) {
                    if (!file.patch) continue;
                    const entry = indexed.find((candidate) => candidate.filename === file.filename);
                    if (!entry) continue;
                    entry.patch = file.patch.slice(0, 8000);
                    entry.patchOffset = 0;
                    entry.nextPatchOffset = file.patch.length > 8000 ? 8000 : null;
                    if (JSON.stringify(compact).length > Math.min(15_000, this.remainingCharacters)) {
                        entry.patch = undefined;
                        entry.patchOffset = undefined;
                        entry.nextPatchOffset = undefined;
                    }
                }
                const output = this.boundedJson(compact);
                if (!z.object({ truncated: z.literal(true) }).safeParse(JSON.parse(output)).success)
                    this.hasGitHubEvidence = true;
                return output;
            }
            const output = this.boundedJson(baseResult);
            if (!z.object({ truncated: z.literal(true) }).safeParse(JSON.parse(output)).success)
                this.hasGitHubEvidence = true;
            return output;
        } else if (
            ["pull", "issues"].includes(kind ?? "") &&
            identifier &&
            /^[1-9]\d*$/.test(identifier) &&
            !rest.length &&
            input.view &&
            input.view !== "metadata"
        ) {
            const view = z.enum(["files", "comments", "reviews", "review-comments"]).parse(input.view);
            if (kind === "issues" && view !== "comments")
                throw new Error("Issue references support metadata or comments only");
            const endpoint =
                view === "comments"
                    ? `issues/${identifier}/comments`
                    : `pulls/${identifier}/${view === "review-comments" ? "comments" : view}`;
            const apiSource = `${base}/${endpoint}?per_page=100&page=${page}`;
            const records =
                view === "files"
                    ? z
                          .array(
                              z.object({
                                  filename: z.string(),
                                  status: z.string(),
                                  patch: z.string().optional(),
                                  previous_filename: z.string().optional(),
                              })
                          )
                          .parse(JSON.parse((await this.download(new URL(apiSource))).toString("utf8")))
                    : z
                          .array(
                              z.object({
                                  id: z.number(),
                                  body: z.string().nullable(),
                                  html_url: z.string().optional(),
                                  path: z.string().optional(),
                                  line: z.number().nullable().optional(),
                                  commit_id: z.string().optional(),
                                  state: z.string().optional(),
                              })
                          )
                          .parse(JSON.parse((await this.download(new URL(apiSource))).toString("utf8")));
            result = {
                source: reference.href,
                apiSource,
                view,
                page,
                records:
                    view === "files" && input.path
                        ? records.filter((record) => "filename" in record && record.filename === input.path)
                        : records,
                nextPage: records.length === 100 && page < 10 ? page + 1 : null,
                limitations:
                    "Mutable upstream discussion/PR evidence, not proof of shipped code. Patches or threads may be truncated; at most 10 pages are available. Follow nextPage, narrow file selections, and report missing evidence.",
            };
        } else if (kind === "issues" && identifier && /^[1-9]\d*$/.test(identifier) && !rest.length) {
            const url = new URL(`${base}/issues/${identifier}`);
            result = {
                source: reference.href,
                ...z
                    .object({
                        title: z.string(),
                        body: z.string().nullable(),
                        state: z.string(),
                        comments: z.number().int().nonnegative(),
                    })
                    .parse(JSON.parse((await this.download(url)).toString("utf8"))),
                limitations:
                    "Mutable issue context. Read comments separately and independently verify claims against pinned code.",
            };
        } else if (kind === "pull" && identifier && /^[1-9]\d*$/.test(identifier) && !rest.length) {
            const url = new URL(`${base}/pulls/${identifier}`);
            const pull = z
                .object({
                    title: z.string(),
                    body: z.string().nullable(),
                    state: z.string(),
                    head: z.object({ sha, repo: z.object({ full_name: z.string() }).nullable() }),
                    base: z.object({ sha, repo: z.object({ full_name: z.string() }) }),
                })
                .parse(JSON.parse((await this.download(url)).toString("utf8")));
            result = {
                source: reference.href,
                ...pull,
                limitations:
                    "PR metadata is mutable. Use the returned repository and exact head/base commits to inspect source; this is not the full PR diff.",
            };
        } else if (kind === "releases" && identifier === "tag" && rest.length) {
            const tag = rest.join("/");
            const url = new URL(`${base}/releases/tags/${encodeURIComponent(tag)}`);
            const release = z
                .object({
                    tag_name: z.string(),
                    name: z.string().nullable(),
                    body: z.string().nullable(),
                    draft: z.boolean(),
                    prerelease: z.boolean(),
                })
                .parse(JSON.parse((await this.download(url)).toString("utf8")));
            if (release.tag_name !== tag) throw new Error("GitHub release identity mismatch");
            result = {
                source: reference.href,
                ...release,
                limitations:
                    "Release notes are mutable context, not proof of affected ranges or the code shipped in our product.",
            };
        } else if (kind === "blob" && identifier && rest.length) {
            const pinned = /^[a-f0-9]{40}$/i.test(identifier);
            const commit = pinned
                ? identifier
                : sha.parse(
                      z
                          .object({ sha })
                          .parse(
                              JSON.parse(
                                  (
                                      await this.download(new URL(`${base}/commits/${encodeURIComponent(identifier)}`))
                                  ).toString("utf8")
                              )
                          ).sha
                  );
            const startLine = input.startLine ?? (anchor?.[1] ? Number(anchor[1]) : 1);
            const requestedCount = input.lineCount ?? (anchor?.[2] ? Number(anchor[2]) - startLine + 1 : 100);
            const source = await this.githubSource({
                repository: `${owner}/${repository}`,
                commit,
                path: rest.join("/"),
                startLine,
                lineCount: Math.min(200, requestedCount),
            });
            return `${pinned ? "Pinned upstream source." : `Mutable upstream ref resolved to ${commit}; not evidence of our shipped version.`}${requestedCount > 200 ? " Requested range truncated to 200 lines." : ""}\n${source}`;
        } else {
            throw new Error(
                "Supported GitHub references: commits by full or unambiguous short SHA, pull requests, releases/tag, security/advisories (global or repository-published), and full-SHA blob URLs. Use readGitHubSource for pinned source."
            );
        }
        const text = this.bounded(JSON.stringify(result, null, 2));
        if (!text.startsWith("External evidence context budget exhausted")) this.hasGitHubEvidence = true;
        return text;
    }

    async gist(input: { url: string; path?: string; startLine?: number; lineCount?: number }): Promise<string> {
        const url = new URL(input.url);
        if (
            url.protocol !== "https:" ||
            url.hostname !== "gist.github.com" ||
            url.port ||
            url.username ||
            url.password ||
            url.search
        )
            throw new Error("Use an HTTPS gist.github.com reference without credentials or query parameters");
        const parts = url.pathname.replace(/\/$/, "").split("/").slice(1);
        const [owner, id, revision] = parts;
        if (
            parts.length < 2 ||
            parts.length > 3 ||
            !owner ||
            !/^[A-Za-z0-9_-]+$/.test(owner) ||
            !id ||
            !/^[a-f0-9]{32}$/i.test(id) ||
            (revision && !/^[a-f0-9]{40}$/i.test(revision))
        )
            throw new Error("Invalid Gist reference");
        const base = `https://api.github.com/gists/${id}`;
        const version =
            revision ??
            z
                .object({ history: z.array(z.object({ version: z.string().regex(/^[a-f0-9]{40}$/i) })).min(1) })
                .parse(JSON.parse((await this.download(new URL(base))).toString("utf8"))).history[0]?.version;
        if (!version) throw new Error("No Gist revision available");
        const record = z
            .object({
                files: z.record(
                    z.string(),
                    z.object({
                        filename: z.string(),
                        content: z.string().optional(),
                        truncated: z.boolean().optional(),
                    })
                ),
            })
            .parse(JSON.parse((await this.download(new URL(`${base}/${version}`))).toString("utf8")));
        const start = z
            .number()
            .int()
            .min(1)
            .parse(input.startLine ?? 1);
        const count = z
            .number()
            .int()
            .min(1)
            .max(200)
            .parse(input.lineCount ?? 100);
        const files = Object.values(record.files)
            .filter((file) => !input.path || file.filename === input.path)
            .map((file) => ({
                filename: file.filename,
                truncated: file.truncated ?? false,
                content:
                    file.content
                        ?.split("\n")
                        .slice(start - 1, start - 1 + count)
                        .map((line, index) => `${start + index}: ${line}`)
                        .join("\n") ?? "Content unavailable; missing evidence.",
            }));
        if (files.some((file) => file.content && !file.truncated) && this.remainingCharacters > 0)
            this.hasGitHubEvidence = true;
        return this.bounded(
            JSON.stringify(
                {
                    source: `https://gist.github.com/${owner}/${id}/${version}`,
                    files,
                    limitations:
                        "Untrusted reproduction/research text only: never execute it. Raw URLs are not followed. Missing or truncated files leave evidence incomplete; a reproduction is not proof of reachability in our product.",
                },
                null,
                2
            )
        );
    }

    async githubSource(input: {
        repository: string;
        commit: string;
        path?: string;
        pathContains?: string;
        startLine?: number;
        lineCount?: number;
    }): Promise<string> {
        const repository = z
            .string()
            .regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/)
            .parse(input.repository);
        if ([".", ".."].includes(repository.split("/")[1] ?? "")) throw new Error("Invalid GitHub repository");
        const commit = z
            .string()
            .regex(/^[a-f0-9]{40}$/i)
            .parse(input.commit);
        const start = z
            .number()
            .int()
            .min(1)
            .parse(input.startLine ?? 1);
        const count = z
            .number()
            .int()
            .min(1)
            .max(200)
            .parse(input.lineCount ?? 100);
        if (
            input.path &&
            (input.path.includes("\\") || input.path.split("/").some((part) => !part || part === "." || part === ".."))
        )
            throw new Error("Invalid GitHub source path");
        const base = `https://api.github.com/repos/${repository}`;
        const key = `${repository}@${commit}`;
        let tree = this.githubTrees.get(key);
        if (!tree) {
            tree = githubTreeSchema.parse(
                JSON.parse((await this.download(new URL(`${base}/git/trees/${commit}?recursive=1`))).toString("utf8"))
            );
            this.githubTrees.set(key, tree);
        }
        const files = tree.tree.filter(
            (entry) =>
                entry.type === "blob" &&
                ["100644", "100755"].includes(entry.mode) &&
                (entry.size ?? MAX_FILE_BYTES + 1) <= MAX_FILE_BYTES
        );
        const source = `https://github.com/${repository}/tree/${commit}`;
        const limitations = tree.truncated
            ? "GitHub tree TRUNCATED; missing paths are unresolved evidence."
            : "Regular files up to 1 MiB only; missing paths are not proof of non-impact.";
        if (!input.path)
            return this.bounded(
                `${source}\n${limitations}\n${files
                    .filter((entry) => !input.pathContains || entry.path.includes(input.pathContains))
                    .map((entry) => entry.path)
                    .join("\n")}`
            );
        const entry = files.find((file) => file.path === input.path);
        if (!entry) return `No readable regular file at that pinned path. ${limitations}`;
        const blob = z
            .object({
                sha: z.string(),
                encoding: z.literal("base64"),
                content: z.string(),
                size: z.number().int().max(MAX_FILE_BYTES),
            })
            .parse(JSON.parse((await this.download(new URL(`${base}/git/blobs/${entry.sha}`))).toString("utf8")));
        const bytes = Buffer.from(blob.content, "base64");
        const digest = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
        if (blob.sha !== entry.sha || digest !== entry.sha || bytes.length !== blob.size)
            throw new Error("GitHub blob identity mismatch");
        if (bytes.includes(0)) return "Binary GitHub source is unavailable; report missing evidence.";
        const lines = bytes
            .toString("utf8")
            .split("\n")
            .slice(start - 1, start - 1 + count);
        if (this.remainingCharacters > 0 && lines.some((line) => line.trim())) this.hasGitHubEvidence = true;
        return this.bounded(
            `${source} file=${input.path}\n${limitations}\n${lines.map((line, index) => `${start + index}: ${line}`).join("\n")}`
        );
    }

    async packageVersions(input: {
        name: string;
        major?: number;
        offset?: number;
        limit?: number;
        requestedVersion?: string;
    }): Promise<string> {
        return this.boundedJson(await this.versionCatalog(input));
    }

    private async versionCatalog(input: {
        name: string;
        major?: number;
        offset?: number;
        limit?: number;
        requestedVersion?: string;
    }): Promise<{
        source: string;
        versions: string[];
        nextOffset: number | null;
        totalVersions: number;
        requestedVersion?: string;
        requestedVersionPresent?: boolean;
        unpublishRecord?: { time?: string; versions?: string[] };
        limitations: string;
    }> {
        packageSchema.parse(input.name);
        if (input.requestedVersion) versionSchema.parse(input.requestedVersion);
        const offset = z
            .number()
            .int()
            .min(0)
            .parse(input.offset ?? 0);
        const limit = z
            .number()
            .int()
            .min(1)
            .max(100)
            .parse(input.limit ?? 50);
        const major = z.number().int().min(0).optional().parse(input.major);
        const source = `https://registry.npmjs.org/${encodeURIComponent(input.name)}`;
        let pending = this.catalogs.get(input.name);
        if (!pending) {
            pending = this.download(new URL(source))
                .then((bytes) => npmCatalogSchema.parse(JSON.parse(bytes.toString("utf8"))))
                .catch((error: unknown) => {
                    this.catalogs.delete(input.name);
                    throw error;
                });
            this.catalogs.set(input.name, pending);
        }
        const catalog = await pending;
        const versions = Object.keys(catalog.versions ?? {})
            .filter((version) => valid(version) && (major === undefined || version.startsWith(`${major}.`)))
            .sort(rcompare);
        return {
            source,
            versions: versions.slice(offset, offset + limit),
            totalVersions: versions.length,
            nextOffset: offset + limit < versions.length ? offset + limit : null,
            ...(input.requestedVersion
                ? {
                      requestedVersion: input.requestedVersion,
                      requestedVersionPresent: Object.hasOwn(catalog.versions ?? {}, input.requestedVersion),
                  }
                : {}),
            ...(catalog.time?.unpublished ? { unpublishRecord: catalog.time.unpublished } : {}),
            limitations:
                "Current npm metadata only. An absent version may never have been published or may have been unpublished. Only an explicit unpublishRecord establishes the registry's reported unpublish event; it does not establish a safe patched version.",
        };
    }

    private async dependencyArchive(input: {
        name: string;
        version: string;
        expectedIntegrity?: string;
    }): Promise<PackageArchive | string> {
        try {
            return await this.packageArchive(input);
        } catch (error) {
            if (!(error instanceof EvidenceHttpError) || error.status !== 404) throw error;
            let discovery;
            try {
                discovery = await this.versionCatalog({
                    name: input.name,
                    major: Number(input.version.split(".")[0]),
                    requestedVersion: input.version,
                });
            } catch (cause) {
                if (!(cause instanceof EvidenceHttpError) || cause.status !== 404) throw cause;
            }
            return this.boundedJson({
                evidenceStatus: "unavailable",
                reasonCode: "npm-resource-not-found",
                httpStatus: 404,
                reason: discovery?.requestedVersionPresent
                    ? "npm advertises this version, but its exact-version metadata or tarball returned HTTP 404. This is not evidence that the version was unpublished."
                    : "npm returned HTTP 404 and does not currently advertise the requested version. It may never have been published or may have been unpublished; absence alone cannot distinguish these cases.",
                recovery:
                    "Use the returned version discovery or readPackageVersions, then verify the advisory's affected range and any candidate fix against source. Do not infer a patched release from version numbering.",
                package: input.name,
                version: input.version,
                discovery,
            });
        }
    }

    async searchDependency(input: {
        name: string;
        version: string;
        expectedIntegrity?: string;
        text: string;
        pathContains?: string;
    }): Promise<string> {
        z.string().min(1).max(200).parse(input.text);
        const archive = await this.dependencyArchive(input);
        if (typeof archive === "string") return archive;
        const { files, integrity } = archive;
        const matches: string[] = [];
        for (const [path, content] of files) {
            if (input.pathContains && !path.includes(input.pathContains)) continue;
            if (path.endsWith(".map") && !input.pathContains?.endsWith(".map")) continue;
            for (const [index, line] of content.split("\n").entries()) {
                if (line.includes(input.text)) matches.push(`${path}:${index + 1}: ${line}`);
                if (matches.length >= 100) break;
            }
            if (matches.length >= 100) break;
        }
        if (matches.length && this.remainingCharacters > 0) this.hasDependencyEvidence = true;
        return this.bounded(
            `${input.name}@${input.version}; ${integrity}; lockfile integrity ${input.expectedIntegrity ? "verified" : "NOT supplied"}\nSource maps excluded unless pathContains ends with .map.\n${matches.join("\n")}\n${matches.length >= 100 ? "[TRUNCATED at 100 matches; narrow the search]" : "Literal text search only; missing matches do not establish non-reachability."}`
        );
    }

    private async packageArchive(input: {
        name: string;
        version: string;
        expectedIntegrity?: string;
    }): Promise<PackageArchive> {
        packageSchema.parse(input.name);
        versionSchema.parse(input.version);
        const key = `${input.name}@${input.version}`;
        const existing = this.packages.get(key);
        const pending =
            existing ??
            this.loadPackage(input.name, input.version).catch((error: unknown) => {
                this.packages.delete(key);
                throw error;
            });
        if (!existing) this.packages.set(key, pending);
        const result = await pending;
        if (input.expectedIntegrity && !input.expectedIntegrity.split(/\s+/).includes(result.integrity))
            throw new Error("Package does not match supplied lockfile SHA-512 integrity");
        return result;
    }

    private async loadPackage(name: string, version: string): Promise<PackageArchive> {
        const metadataUrl = new URL(
            `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
        );
        const metadata = z
            .object({
                name: z.string(),
                version: z.string(),
                dist: z.object({ tarball: z.string().url(), integrity: z.string() }),
            })
            .parse(JSON.parse((await this.download(metadataUrl)).toString("utf8")));
        if (metadata.name !== name || metadata.version !== version)
            throw new Error("Registry package identity mismatch");
        const tarballUrl = new URL(metadata.dist.tarball);
        if (tarballUrl.hostname !== "registry.npmjs.org" || tarballUrl.search)
            throw new Error("Tarball must use the public npm registry");
        const archive = await this.download(tarballUrl);
        const integrity = metadata.dist.integrity.split(/\s+/).find((value) => value.startsWith("sha512-"));
        if (!integrity) throw new Error("Registry package has no SHA-512 integrity");
        const expected = Buffer.from(integrity.slice(7), "base64");
        const actual = createHash("sha512").update(archive).digest();
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
            throw new Error("Package integrity mismatch");
        if (this.remainingArchiveBytes <= 0) throw new Error("Dependency archive budget exhausted");
        const expanded = gunzipSync(archive, { maxOutputLength: this.remainingArchiveBytes });
        this.remainingArchiveBytes -= expanded.byteLength;
        const contents = await archiveFiles(expanded);
        return {
            ...contents,
            source: metadataUrl.href,
            tarball: tarballUrl.href,
            integrity: `sha512-${actual.toString("base64")}`,
        };
    }

    async artifact(input: {
        name: string;
        version: string;
        expectedIntegrity?: string;
        pathContains?: string;
        offset?: number;
        limit?: number;
        releaseScope?: { commit: string; label: string };
    }): Promise<string> {
        const artifact = await this.packageArchive(input);
        const manifest = z
            .object({
                name: z.string(),
                version: z.string(),
                main: z.string().optional(),
                bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
                exports: z.unknown().optional(),
                dependencies: z.record(z.string(), z.string()).optional(),
                optionalDependencies: z.record(z.string(), z.string()).optional(),
                peerDependencies: z.record(z.string(), z.string()).optional(),
                bundledDependencies: z.union([z.boolean(), z.array(z.string())]).optional(),
                bundleDependencies: z.union([z.boolean(), z.array(z.string())]).optional(),
                scripts: z.record(z.string(), z.string()).optional(),
            })
            .parse(JSON.parse(artifact.files.get("package.json") ?? "null"));
        if (manifest.name !== input.name || manifest.version !== input.version)
            throw new Error("Artifact manifest identity mismatch");
        const offset = z
            .number()
            .int()
            .min(0)
            .parse(input.offset ?? 0);
        const limit = z
            .number()
            .int()
            .min(1)
            .max(200)
            .parse(input.limit ?? 100);
        const selected = artifact.entries.filter(
            (entry) => !input.pathContains || entry.path.includes(input.pathContains)
        );
        const result = this.boundedJson({
            releaseScope: input.releaseScope,
            source: artifact.source,
            tarball: artifact.tarball,
            integrity: artifact.integrity,
            lockfileIntegrity: input.expectedIntegrity ? "verified" : "not supplied",
            manifest,
            totalEntries: artifact.entries.length,
            matchingEntries: selected.length,
            entries: selected.slice(offset, offset + limit),
            nextOffset: offset + limit < selected.length ? offset + limit : null,
            embeddedLocksAndSboms: artifact.entries
                .filter((entry) =>
                    /(?:^|\/)(?:npm-shrinkwrap\.json|package-lock\.json|pnpm-lock\.yaml)$|(?:sbom|cyclonedx|spdx)/i.test(
                        entry.path
                    )
                )
                .map((entry) => entry.path),
            limitations: [
                "Inventory of this exact npm tarball, not an installed dependency closure or automatically verified SBOM. Other release distributions are not inspected.",
                "Bundles may embed dependencies without separate package manifests. External dependency ranges do not prove installed versions. Inspect bundle source, embedded locks/SBOMs and runtime entry points separately.",
                "Unreadable entries include unsafe paths, links, binary and oversized files; missing readable source is not proof of absence. Patches from the repository are not applied to registry archives.",
            ],
        });
        if (this.remainingCharacters > 0) this.hasArtifactEvidence = true;
        return result;
    }

    async dependency(input: {
        name: string;
        version: string;
        expectedIntegrity?: string;
        path?: string;
        pathContains?: string;
        startLine?: number;
        lineCount?: number;
    }): Promise<string> {
        const archive = await this.dependencyArchive(input);
        if (typeof archive === "string") return archive;
        const { files, integrity } = archive;
        const source = `https://registry.npmjs.org/${encodeURIComponent(input.name)}/${encodeURIComponent(input.version)}`;
        if (!input.path)
            return this.bounded(
                `${source}\nAvailable text files (regular files only, max 1 MiB each):\n${[...files.keys()].filter((path) => !input.pathContains || path.includes(input.pathContains)).join("\n")}`
            );
        const text = files.get(input.path);
        if (text === undefined)
            return "No readable regular text file at that exact package path; report missing evidence.";
        const start = input.startLine ?? 1;
        const count = input.lineCount ?? 100;
        if (!Number.isInteger(start) || start < 1 || !Number.isInteger(count) || count < 1 || count > 200)
            throw new Error("Invalid dependency line range");
        const lines = text.split("\n").slice(start - 1, start - 1 + count);
        if (this.remainingCharacters > 0 && lines.some((line) => line.trim())) this.hasDependencyEvidence = true;
        return this.bounded(
            `${source} file=${input.path}; ${integrity}; lockfile integrity ${input.expectedIntegrity ? "verified" : "NOT supplied"}\n${lines.map((line, index) => `${start + index}: ${line}`).join("\n")}`
        );
    }
}

function reportText(html: string, source: URL): { text: string[]; references: string[] } {
    const root = parse(html);
    const text: string[] = [];
    const links = new Set<string>();
    const pending: DefaultTreeAdapterMap["node"][] = [root];
    let visited = 0;
    while (pending.length) {
        const node = pending.pop();
        if (!node) break;
        if (++visited > 100_000) throw new Error("HTML report node budget exceeded");
        if (
            ["script", "style", "noscript", "template", "nav", "header", "footer", "form", "svg"].includes(
                node.nodeName
            )
        )
            continue;
        if ("attrs" in node && node.nodeName === "a") {
            const href = node.attrs.find((attribute) => attribute.name === "href")?.value;
            if (href && links.size < 200) {
                try {
                    const target = new URL(href, source);
                    if (target.protocol === "https:" && !target.username && !target.password) links.add(target.href);
                } catch {
                    continue;
                }
            }
        }
        if ("value" in node) {
            const value = node.value.replace(/\s+/g, " ").trim();
            if (value) text.push(value);
        }
        if ("childNodes" in node) pending.push(...[...node.childNodes].reverse());
    }
    if (!text.length) throw new Error("No readable report text; missing evidence");
    return { text, references: [...links] };
}

async function archiveFiles(archive: Buffer): Promise<Pick<PackageArchive, "files" | "entries">> {
    const parser = extract();
    const files = new Map<string, string>();
    const entries: PackageArchive["entries"] = [];
    parser.end(archive);
    try {
        for await (const stream of parser) {
            const header = stream.header;
            if (entries.length >= 5000) throw new Error("Archive entry budget exceeded");
            const parts = header.name.split("/");
            const safe =
                parts[0] === "package" &&
                parts.length > 1 &&
                parts.every((part) => part && part !== "." && part !== "..") &&
                !header.name.includes("\\");
            const readable = safe && header.type === "file" && (header.size ?? 0) <= MAX_FILE_BYTES;
            const data = await buffer(stream);
            const path = parts.slice(1).join("/");
            if (readable && !data.includes(0)) {
                if (files.has(path)) throw new Error("Duplicate archive file path");
                files.set(path, data.toString("utf8"));
            }
            entries.push({
                path: safe ? path : header.name,
                type: header.type ?? "unknown",
                bytes: header.size ?? 0,
                readable: readable && !data.includes(0),
            });
        }
        return { files, entries };
    } finally {
        parser.destroy();
    }
}
