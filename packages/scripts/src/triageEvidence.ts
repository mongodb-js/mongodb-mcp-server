import { createHash, timingSafeEqual } from "node:crypto";
import { buffer } from "node:stream/consumers";
import { gunzipSync } from "node:zlib";
import { extract } from "tar-stream";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { z } from "zod/v4";
import { setTimeout as delay } from "node:timers/promises";

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
};

const packageSchema = z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
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

export class TriageEvidence {
    hasAdvisoryEvidence = false;
    hasDependencyEvidence = false;
    hasGitHubEvidence = false;
    hasSupplementalEvidence = false;
    hasArtifactEvidence = false;
    private readonly request: typeof fetch;
    private readonly limits: EvidenceLimits;
    private remainingRequests: number;
    private remainingCharacters: number;
    private remainingArchiveBytes: number;
    private remainingDownloadBytes: number;
    private retries = 0;
    private readonly packages = new Map<string, Promise<PackageArchive>>();
    private readonly githubTrees = new Map<string, z.infer<typeof githubTreeSchema>>();
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
        archiveBytes: number;
        contextCharacters: number;
        limits: EvidenceLimits;
    } {
        return {
            requests: this.limits.requests - this.remainingRequests,
            retries: this.retries,
            downloadBytes: this.limits.downloadBytes - this.remainingDownloadBytes,
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
        if (text.length > Math.min(16_000, this.remainingCharacters))
            return JSON.stringify({
                truncated: true,
                limitations: [
                    "Structured evidence exceeds remaining context budget; request narrower evidence. No complete facts returned.",
                ],
            });
        return this.bounded(text);
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
        const allLines = JSON.stringify(content, null, 2).split("\n");
        const lines = allLines.slice(start - 1, start - 1 + count);
        if (lines.length && this.remainingCharacters > 0) this.hasSupplementalEvidence = true;
        return this.bounded(
            `${source}\nResult range starts at ${start}; ${lines.length} of ${allLines.length} total lines returned. Use startLine to continue.\nUntrusted supplemental context; CWE is general background, and vendor product conclusions do not establish impact in our product. No scripts, assets, payloads, or linked URLs are executed/fetched.\n${lines.map((line, index) => `${start + index}: ${line}`).join("\n")}`
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

    async advisory(id: string): Promise<string> {
        const normalized = id.toUpperCase();
        const ghsa = /^GHSA-[23456789CFGHJMPQRVWX]{4}(?:-[23456789CFGHJMPQRVWX]{4}){2}$/;
        const cve = /^CVE-\d{4}-\d{4,}$/;
        if (!ghsa.test(normalized) && !cve.test(normalized))
            throw new Error("Use a GHSA or CVE identifier, not an arbitrary URL");
        const url = ghsa.test(normalized)
            ? new URL(`https://api.github.com/advisories/${normalized.toLowerCase()}`)
            : new URL(`https://api.github.com/advisories?cve_id=${normalized}&per_page=10`);
        const json: unknown = JSON.parse((await this.download(url)).toString("utf8"));
        const schema = z.object({
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
        const advisories = z.array(schema).parse(Array.isArray(json) ? json : [json]);
        if (!advisories.length)
            return "No matching GitHub advisory; this is missing evidence, not proof of non-impact.";
        if (this.remainingCharacters > 0) this.hasAdvisoryEvidence = true;
        return this.boundedJson({ source: url.href, advisories });
    }

    async githubReference(input: {
        url: string;
        path?: string;
        page?: number;
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
            return this.advisory(rest[0]);
        } else if (kind === "commit" && identifier && /^[a-f0-9]{40}$/i.test(identifier) && !rest.length) {
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
            if (commit.sha.toLowerCase() !== identifier.toLowerCase())
                throw new Error("GitHub commit identity mismatch");
            result = {
                source: reference.href,
                apiSource: url.href,
                commit: commit.sha,
                message: commit.commit.message,
                files: commit.files.filter((file) => !input.path || file.filename === input.path),
                page,
                nextPage: commit.files.length === 100 && page < 10 ? page + 1 : null,
                limitations:
                    "GitHub may omit or truncate patches. At most 10 pages are available. Missing files/patches are not proof of non-impact; read source at an exact commit when needed.",
            };
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
                "Supported GitHub references: full-SHA commits, pull requests, releases/tag, security/advisories, and full-SHA blob URLs. Use readGitHubSource for pinned source."
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

    async searchDependency(input: {
        name: string;
        version: string;
        expectedIntegrity?: string;
        text: string;
        pathContains?: string;
    }): Promise<string> {
        z.string().min(1).max(200).parse(input.text);
        const { files, integrity } = await this.packageArchive(input);
        const matches: string[] = [];
        for (const [path, content] of files) {
            if (input.pathContains && !path.includes(input.pathContains)) continue;
            for (const [index, line] of content.split("\n").entries()) {
                if (line.includes(input.text)) matches.push(`${path}:${index + 1}: ${line}`);
                if (matches.length >= 100) break;
            }
            if (matches.length >= 100) break;
        }
        if (matches.length && this.remainingCharacters > 0) this.hasDependencyEvidence = true;
        return this.bounded(
            `${input.name}@${input.version}; ${integrity}; lockfile integrity ${input.expectedIntegrity ? "verified" : "NOT supplied"}\n${matches.join("\n")}\n${matches.length >= 100 ? "[TRUNCATED at 100 matches; narrow the search]" : "Literal text search only; missing matches do not establish non-reachability."}`
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
        const { files, integrity } = await this.packageArchive(input);
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
