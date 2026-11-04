# Generate Scripts

This folder contains a helper script which generates various documentation and configurations based on our code.

## Files

- **`index.ts`** - Main entry point that orchestrates all generation tasks
- **`generateArguments.ts`** - Generates CLI arguments, environment variables, and configuration tables from the UserConfig Zod Schema
- **`generateToolDocumentation.ts`** - Generates tool documentation by reading from the AllTools array

## Usage

Run all generators:

```bash
pnpm run generate:arguments
```

## Vulnerability Auto-Triage PoC

Run locally from the repository root, independently of GitHub Actions:

```bash
pnpm install
git fetch origin main
pnpm triage:vulnerabilities --help
pnpm triage:vulnerabilities --limit 1
```

Provide `GROVE_API_KEY`, `JIRA_URL` (for example, `https://jira.mongodb.org`), and `JIRA_TOKEN` through your environment or secret manager. The Jira token uses Bearer/PAT authentication. Do not put credentials in command-line arguments or commit them. Confirm the Grove key is approved for the ticket data and complete the required Jira integration review before using production data.

This script uses **AI Gateway** at `https://ai-gateway.corp.mongodb.com` for model discovery and inference, authenticated with the `x-api-key` header. Set `GROVE_API_KEY` to your approved request's **Gateway Key**; legacy keys and the old Grove/Foundry endpoint are not supported. The endpoint and authentication match the maintained internal [AI Gateway client](https://github.com/10gen/grove-gateway-opencode-plugin). Model requests reject redirects, and the gateway URL participates in the comment cache fingerprint. If inference is denied, check the key's validity and model access; `--model` cannot bypass authorization.

This is **always a dry run for Jira**. The only Jira HTTP method implemented is GET; there is no apply/write option. A PAT inherits the owner's permissions, so use a separately provisioned read-only Jira identity if permissions must also be enforced server-side. Redirects are rejected to avoid forwarding credentials.

Dry-run mode still sends ticket content and selected repository/dependency files and advisories to Grove, and incurs inference costs. Public evidence requests send advisory IDs or npm package names/versions to GitHub and npm, never Jira/Grove credentials or ticket bodies. Treat stdout as internal vulnerability data. Each stdout line is a JSON object with the issue, action, generated comment, and proposed HTTP method/path/body. Progress and failures go to stderr. Any failed ticket sets a nonzero exit code and produces no write proposal for that ticket; other tickets can still succeed. Findings are initial investigations for human review, never a final impact determination.

### Ticket Selection And Repository Context

The default query is `filter = 63609`, intersected with `issuetype = "Static Code Analysis Finding"`. It reads at most **one ticket** by default. Override the query to narrow the filter to tickets for the repository being investigated:

```bash
pnpm triage:vulnerabilities --jql 'filter = 63609 AND key = VULN-12345'
pnpm triage:vulnerabilities --jql 'project = YOURPROJECT' --limit 5
pnpm triage:vulnerabilities --repo /path/to/another/checkout --ref origin/main
pnpm triage:vulnerabilities --ref origin/main --release-ref '<known-release-tag-or-commit>'
```

The query must select tickets for the supplied repository; the script does not infer a repository from a ticket. It reads a **pinned Git commit**, defaulting to `origin/main`, not the working tree. Fetch the intended revision yourself first. It never checks out branches, fetches, changes files, executes project code, or runs model-supplied shell commands. Untracked files, symlinks, submodules, `.env*`, `.npmrc`, and private-key files are unavailable to its tools. This is not a general secret scanner: review the chosen commit before sending its contents to Grove.

No release flag is required. By default, the script reads npm's `latest` metadata for the published product, then resolves its source using `gitHead`, npm SLSA provenance, or the matching GitHub `v<version>` tag, in that order. Provenance is checked against the npm artifact's SHA-512 digest and the product's repository URL; GitHub annotated tags are dereferenced to commits. The resolved commit's product manifest must match npm's package name and version. The local package version is not treated as proof of publication, and neither the highest local tag nor the most recent GitHub release is substituted for npm's default release channel.

For this monorepo, the product manifest is `packages/mongodb-mcp-server/package.json`; for a single-package checkout it is the root `package.json`. Manifest reads use the pinned main target, not uncommitted changes. A private package without a recognized product manifest requires an explicit override. Source objects must already exist locally: if the resolved commit is missing, run `git fetch origin --tags`. Automatic discovery never fetches or changes the checkout. If metadata/source discovery fails or the source manifest disagrees, the run stops before inference instead of silently assessing main as a release. The scope preamble records the discovered package version, metadata/provenance URL, and commit. The npm provenance is retrieved over HTTPS; the PoC does not independently verify the full Sigstore signature chain.

`--release-ref` overrides automatic discovery for a known tag or commit and bypasses the npm release lookup. An explicit ref is not automatically verified as the latest published release or the ticket's historical affected release. Use it to investigate a particular historical release when needed, and narrow the ticket query accordingly. A version recorded in a ticket is historical evidence, not a replacement for the latest-release target.

The model's repository tools select `main` or `release`, each pinned independently, and both must be inspected. Findings are prompted to separate **Released product**, **Current main**, **Evidence**, and **Missing evidence**. Fixes on main are not treated as released fixes.

The model can list paths, read numbered file ranges, perform bounded literal searches, and query the deterministic dependency graph. Defaults are 30 model steps per ticket, 6,000 output tokens per step (including the structured final report), 200,000 repository characters per target, and a ten-minute investigation deadline. `--steps` accepts 2 through 100; `--limit` accepts 1 through 100. Oversized ticket inputs, truncated or malformed final reports, and investigations without a successful repository read or graph query for each supplied target fail closed. These are maximum budgets, not a promise that an investigation is complete.

### Dependency Graph And Published Artifact

`dependencyPaths` parses the **full pinned root pnpm v9 lockfile**, not the truncated output of `readFile`. It returns resolved occurrences and paths for a package name, starting from the product importer by default. It follows production, optional, workspace-link, alias, and resolved peer edges; retains distinct peer snapshot identities and multiple versions; and exposes package integrity, platform conditions, overrides, and patch metadata. Optional/platform edges are retained, not assumed active. Local patches are identified but not applied to downloaded registry source.

Set `importer` to a lockfile importer path or `"*"` for all importers, and `includeDev: true` to include the selected roots' development edges. Development edges of nested workspaces are not automatically included. The model must inspect build roots and packaging when development dependencies could be bundled. Workspace manifests and the lockfile are read from the same commit, never from local `node_modules`. Queries record their source commit and expose importers, resolution gaps, path truncation, and graph size. Path enumeration is cycle-safe, limited to 25 paths by default (up to 100), depth 100 and 100,000 expansions; graph construction is capped at 50,000 nodes and 100,000 edges. Unsupported lockfile versions, missing snapshots, non-registry resolutions and budget limits leave explicit gaps. Other lockfile formats require manual investigation with the repository tools; no dependency graph is inferred for them.

`readProductArtifact` binds the package name/version to the **pinned release product manifest**, then reads its exact public npm tarball. It verifies registry SHA-512 and the tarball manifest identity, returns published dependency declarations and entry points, and inventories files with type, size, and readable status. `pathContains`, `offset`, and `limit` (up to 200) paginate the inventory. Embedded lockfile and SBOM filenames are reported for further inspection via `readDependency`; they are not automatically interpreted or trusted. An explicit `--release-ref` does not verify that npm bytes were built from that commit. Automatic release discovery supplies the separately checked source mapping described above.

An npm inventory is **not an installed dependency closure or a verified SBOM**. Dependencies may be bundled into generated files, installed later from ranges, loaded dynamically, or shipped in other distributions. Binary, oversized and link entries cannot be read as source. Neither absence from readable files nor absence from the production-root lockfile graph proves exclusion from the product. Inspect bundle/build rules, the published source and runtime entry points before concluding non-impact.

### Advisory And Dependency Evidence

`readAdvisory` accepts a CVE or GHSA identifier and retrieves GitHub's public advisory record: affected packages/version ranges, patched versions, exploitation details, withdrawal/update metadata, and references. `readGitHubReference` also accepts repository advisory links. Missing records, rate limits, and API errors are missing evidence, not proof of non-impact.

`readGitHubReference` follows supported public `github.com` references through the GitHub API, not an unrestricted web browser:

- Commit links with full 40-character SHAs return the commit message and changed-file patches, including regression tests. An exact `path` filters the current page; `page` accepts 1 through 10, with up to 100 files per page. Follow `nextPage` when present. GitHub may omit or truncate patches; the response and context-limit markers warn about incomplete evidence.
- Pull-request links default to metadata, including exact head/base commits and repositories. Set `view: "files"` to read the full PR's changed-file patches, `"comments"` for discussion, `"reviews"` for review summaries, or `"review-comments"` for inline review threads. These views support the same bounded paging; patches/threads may be incomplete. Issue links support metadata or `"comments"`. Metadata alone and a head commit's diff are not the full PR.
- Release-tag links return release notes, not proof that our product ships that release or contains a fix.
- Repository advisory links retrieve the canonical GHSA record. `blob` links preserve `#Lstart-Lend` anchors; individual reads are capped at 200 lines. A mutable upstream branch/tag component (such as `main`) is resolved to a full commit SHA before reading. This never changes the independently pinned product targets or proves which code we ship; slash-containing refs should be resolved and read explicitly with `readGitHubSource`.
- `gist.github.com` links resolve to a specific revision before reading numbered file content. Use `path` to select a filename and line ranges to narrow results. Raw URLs and truncated files are not followed automatically. Reproduction code is read as untrusted text, never executed.

`readGitHubSource` lists regular file paths or reads numbered source/test lines at an exact commit in an `owner/repository`. Omit `path` to list files and use `pathContains` to narrow the listing. Tree lookups are cached per repository/commit. Source blobs must match the Git tree entry and Git blob hash; symlinks, submodules, binaries, and files above 1 MiB are not exposed. Truncated or oversized trees leave paths unresolved rather than proving absence. Upstream code must still be compared with the exact dependency artifact we ship.

`readDependency` accepts a public npm package name and **exact version**, lists the published tarball's readable files, then reads selected numbered source ranges. The model must establish the relevant package/version and production dependency path independently for each target; local `node_modules` is not treated as evidence. Tarball bytes are SHA-512-verified against registry metadata, parsed in memory, and never written to disk, installed, or executed. Both `readDependency` and `searchDependency` accept `expectedIntegrity` from the graph to additionally verify the lockfile's SHA-512; a mismatch fails even for cached archives. Missing lockfile integrity is labelled, not silently treated as verified. Concurrent reads of the same package/version share one download. Local patches are not applied. Symlinks, hardlinks, traversal paths, binary files, and source files above 1 MiB are not exposed as text.

`searchDependency` searches literal text in the same verified exact-version archive and returns at most 100 numbered matches, optionally narrowed by `pathContains`. It can inspect intermediate transitive dependencies as well as the vulnerable package. `readDependency` also accepts `pathContains` when listing files. Searches are not a sound static call-graph analysis: missing matches do not establish non-reachability.

For **each** target, the investigation instructions require a shipped dependency chain with resolved versions, the affected symbol, a caller trace from production entry points through direct/transitive dependencies, and evidence for exploitation prerequisites (configuration, packaging/bundling, and attacker-controlled input). Findings distinguish **likely-affected**, **likely-not-affected**, and **needs-investigation**, with path/line citations and unresolved links called out. Package presence, no matching import, a development-only manifest label, or a fix on main is not sufficient by itself. A likely-not-affected recommendation needs a concrete exclusion supported by evidence. Dependency resolution is deterministic for supported lockfiles, but function-level reasoning remains model-driven. Structured evidence checks constrain recommendations; they are not a formal reachability proof or an automated final verdict.

`readReference` retrieves NVD/CVE.org records through their canonical JSON APIs with CVE identity checks; CWE definition pages; and specific report paths on Snyk, VulnCheck, CodeAnt, Red Hat CVE/Bugzilla/CSAF, OpenJS CNA, and VulDB. It also routes supported GitHub/Gist and Kondukto URLs to their readers. HTML is parsed with `parse5` as text plus reference links: scripts, styles, forms, navigation, images, and other subresources are never executed or fetched. It is not a browser or an arbitrary URL fetcher. Supplemental responses expose numbered result ranges for continuation. Login/paywall/anti-bot pages, redirects, absent records, and conflicting vendor claims must be reported as missing or uncertain evidence, not proof of safety. CWE is general background; vendor product applicability is not automatically applicability to this server.

All network access requires HTTPS and rejects redirects. Investigation budgets are shared across external tools per ticket:

| Flag                   | Default | Allowed Range                                                         |
| ---------------------- | ------- | --------------------------------------------------------------------- |
| `--max-requests`       | 200     | 1-2,000 external requests                                             |
| `--steps`              | 30      | 2-100 model steps                                                     |
| `--deadline-seconds`   | 600     | 30-3,600 seconds                                                      |
| `--context-characters` | 200,000 | 16,000-2,000,000 characters per repository target and external reader |
| `--archive-mib`        | 128     | 1-1,024 MiB total expanded tarballs                                   |
| `--download-mib`       | 256     | 1-1,024 MiB total received evidence                                   |
| `--response-mib`       | 20      | 1-50 MiB per download                                                 |

For a deeper investigation:

```bash
pnpm triage:vulnerabilities --steps 50 --max-requests 400 --deadline-seconds 1200
```

Budgets are finite and validated before Jira access; increasing them can increase model costs or exceed the selected model's context window. The deadline covers model inference and external tools; each evidence HTTP request also has a 20-second timeout. Individual tool results remain capped at 16,000 characters; archives allow 5,000 entries each and source reads allow 1 MiB per file. Request/download/expanded-archive/context usage and configured external limits are included in the proposed comment. Automatic release discovery uses a separate reader with default limits, outside the per-ticket investigation deadline. Provider and anonymous GitHub API rate limits still apply independently; increasing `--max-requests` does not bypass them.

Repository Git commands remain synchronous: they temporarily block timer callbacks, but each command is capped at the smaller of 10 seconds or the investigation's remaining wall-clock time. Wall-clock checks reject expired work before and after commands and before accepting the report. This bounds Git work; it does not provide immediate asynchronous cancellation. Initial revision discovery is outside the per-ticket deadline. Graph results trim path detail before serialization while retaining complete occurrences and independent product-root coverage; if those facts cannot fit, a parseable JSON gap replaces them. Oversized structured facts return an explicit incomplete result, never sliced JSON, and fallback output is charged to the remaining context budget. Artifact evidence includes the release commit and scope label.

`readAdvisory` retains complete affected-version records while paging descriptions and references. Defaults are 1,000 description characters and 10 references per advisory. Follow `nextDescriptionOffset` using `descriptionOffset` and `descriptionCharacters` (1..4,000); follow `nextReferenceOffset` using `referenceOffset` and `referenceLimit` (1..50). Use an individual returned GHSA ID to narrow a multi-advisory CVE result. Descriptive pages shrink further when needed to preserve version facts within the output budget. If even the complete version facts cannot fit, the result is explicitly incomplete and does not mark advisory facts as retrieved. A description excerpt alone does not establish all prerequisites; inspect the remaining pages.

Public requests send no authentication. Public hosts and report paths are explicitly allowlisted; localhost, lookalike domains, arbitrary queries, credentials in URLs, and unsupported paths are rejected. URLs used as exploit-payload examples must not be fetched. Private registries/repositories, non-npm dependencies, and arbitrary vendor pages remain unsupported. Tool outputs are untrusted evidence, never instructions.

### Optional Kondukto Evidence

For live individual finding reads, configure **both** `KONDUKTO_URL` (an HTTPS SaaS origin such as `https://example.kondukto.io`) and `KONDUKTO_TOKEN` (a separately provisioned read-only token). The model cannot choose the credential destination. An individual project finding URL's `id=in:<24-hex-id>` is mapped to the documented `GET /api/v2/vulnerabilities/{id}` endpoint and its returned identity is checked. Only that configured origin and endpoint receive the token in `X-Cookie`; Jira/Grove credentials are never forwarded. No scan starts, updates, or other writes are exposed. See the [Kondukto authentication](https://docs.kondukto.io/reference/starting-with-kondukto-api.md) and [finding details](https://docs.kondukto.io/reference/get-vulnerability-details.md) documentation.

Grouped finding URLs use offline evidence rather than a broad unfiltered API search. Individual URLs can use exports too, without scanner credentials:

```bash
pnpm triage:vulnerabilities --evidence-file /absolute/path/scanner-evidence.json
```

The file is a JSON array, at most 1 MiB and 100 entries. Wrap exported scanner data as `evidence`, keyed by the exact source URL (including query ordering); duplicate URLs are rejected:

```json
[
  {
    "url": "https://example.kondukto.io/vulnerabilities/appsec?issueId=in:VULN-123",
    "evidence": { "findings": [] }
  }
]
```

Offline exports are explicitly labelled potentially stale. Their SHA-256 digest participates in caching; the token itself does not. Both live and exported scanner evidence are optional context, not proof of reachability. Export contents are sent to Grove when read, so include only approved data and do not commit internal exports. Live authenticated access requires a separate deployment validation with approved credentials.

The historical remediated tickets used to evaluate reference formats are test data, not a dependency of the automation. No previous human triage notes are supplied to the model. Production ticket selection must exclude completed/remediated findings via its JQL/filter.

Each comment includes a deterministic scope/evidence-coverage preamble, so absent advisory, dependency, GitHub, graph, or product-artifact reads remain visible even if the generated findings omit them; supplemental retrieval is recorded separately. A queried graph can still have resolution gaps, and a retrieved reference may be metadata only: coverage flags do not prove a complete caller trace. Missing required evidence makes the assessment incomplete. The model must not equate absence of evidence with non-impact.

### Human Review Report

The CLI uses the AI SDK's schema-output API with provider JSON-schema output and renders the Jira comment itself. The gateway/model must support schema output; adapter contracts are tested locally, not guaranteed by catalog discovery. **Every report is investigation and recommendation only; a human makes the final disposition.** There is no automated ticket closure, risk acceptance, remediation, or status change. The existing GET-only Jira and dry-run boundaries are unchanged.

Release and main each report the package and resolved versions, supplied advisory range, dependency path, affected behavior, caller trace, packaging, exploitation prerequisites, any proposed exclusion, blocking missing evidence, nonblocking limitations, and concrete follow-up for the reviewer. Recommendations are `likely-affected`, `likely-not-affected`, or `needs-investigation`, never a final decision. A complete report still asks for human verification.

Evidence checks validate actual tool-call citation IDs, unique attribution, availability, target scope, appropriate source-tool categories, and consistency of supplied versions against retrieved npm advisory data. Likely-impact and unaffected-version recommendations require exact versions observed in cited target graph occurrences or the matching product artifact manifest; a generic source-file citation is insufficient. The supplied affected range must be semver-equivalent to the union of matching, non-withdrawn npm vulnerability records in cited GitHub advisory results. Any unparseable matching range makes version-based grounding incomplete, even if other matching ranges parse; it is never silently removed from the union. Wrong-package/wrong-ecosystem records, withdrawn advisories, changed ranges, and invented versions are not accepted as grounding. Comma-separated constraints are normalized; semantically equivalent ranges need not use identical spelling. Unsupported/truncated formats or other advisory sources can still inform a human-reviewed investigation, but do not satisfy these machine checks.

GitHub/advisory/reference results support advisory context; file inventories alone do not support affected implementation claims. Likely impact also needs a cited production path, behavior/caller source, packaging, and established target-specific prerequisites. Likely non-impact needs a concrete target-specific exclusion; a truncated exclusion is insufficient. An unaffected-version recommendation checks all reported versions and flags copies omitted from observed target/package graph results, unresolved graph edges, or an unreadable graph result. A main-only citation cannot establish released-product applicability.

Every dependency query also computes production/optional coverage from the harness-selected product importer, independent of the model's requested importer. Unaffected-version exclusions require that complete product-root coverage and must account for its observed versions; a narrow test/workspace query alone cannot establish non-impact. Old replay ledgers without this coverage are downgraded. Versions must be outside the advisory range under both ordinary and prerelease-inclusive semver evaluation to support an unaffected-version exclusion. Disagreement requires investigation rather than assuming either safety or exploitability.

These are **minimum consistency checks, not semantic proof**: they do not prove that a cited line establishes a behavior claim, that the advisory is the right vulnerability for the ticket, that a dependency path is a complete call graph, or that deployment assumptions hold. They ground supported version/range claims only in the retrieved structured evidence, not in independently refreshed or complete installed-dependency data. File/line locators and the reasoning itself still need human review. An explicit release ref's unverified artifact mapping also remains a limitation. Do not treat an unflagged recommendation as validated safety or permission to close a ticket.

Unsupported recommendations are downgraded to `needs-investigation`, preserving the model's original proposal, explanation, citations, and the check findings for review. Incomplete investigations remain useful output when both repository targets were inspected. Invalid JSON, schema-invalid output, or incomplete inference produces no proposed comment rather than accepting arbitrary prose or spending additional inference on a repair attempt.

Dry-run JSONL includes harness-generated `investigation.scope` (the pinned main commit and release commit, package name/version and provenance label), `investigation.assessment` (original target assessments, checked recommendations, check findings, and `humanDecisionRequired: true`) and `investigation.evidence`. Scope is separate from model output and is retained even for investigations using only file reads. Each evidence record contains the actual tool-call ID, tool name, target when applicable, input arguments, returned output, availability (`retrieved`, `limited`, or `unavailable`), and SHA-256 of that output. Failed calls are unavailable records with a generic failure marker, not supporting evidence; raw exceptions and credential-bearing HTTP headers are not recorded. The model receives an explicit evidence-ID index between steps, and the rendered comment includes an index for citations it used.

The harness index uses the SDK's per-step system channel and contains only validated identifiers and harness metadata, never tool arguments or returned text. Those remain untrusted tool data. Model/evidence values are escaped and line-normalized in the Jira rendering so they cannot introduce report blocks, macros, or explicit wiki links. The structured assessment and evidence ledger retain the original data for human inspection.

The ledger contains **bounded tool outputs**, not full downloads, every archive file, or cryptographic proof of origin. Retain the JSONL under the same internal-data controls as ticket/source evidence; it may be substantially larger than the rendered comment. The script does not persist it or add an external audit service. Matching cached comments skip inference and have no fresh investigation ledger.

### Offline Replay

Save a live dry-run's stdout to an approved internal location, then recheck its saved evidence with the current assessment rules:

```bash
pnpm triage:vulnerabilities --limit 1 > /approved/internal/run.jsonl
pnpm triage:vulnerabilities --replay-file /approved/internal/run.jsonl
```

Replay requires no credentials, Git checkout operations, network requests or model inference, and takes precedence over live-mode options. Input is 1 through 100 nonblank JSONL entries, at most 32 MiB. Use the script's JSONL output, not package-manager progress banners. Replay validates the input schema, unique evidence IDs, and each saved output's SHA-256, then reconstructs target/availability classifications from tool names, arguments and returned text. Saved check results are not trusted as the new result. All entries are validated before any replay result is printed; malformed input or altered output hashes fail without partial results.

Each replay result has `replay: true`, original and rechecked recommendations, `recommendationChanged`, the updated human-review report and evidence ledger. Structured scope is schema-validated, retained unchanged, and rendered in the replay report, including through repeated replays. Older ledgers without structured scope remain readable but return `scope: null` and an explicit unknown-scope warning; commits and release identities are not guessed from prose. It has **no `proposedRequest`**. Cached skip entries become `skip-replay` because they have no fresh ledger. Replay output can itself be replayed after another rule change.

Replay does not refresh advisories, release mappings, source, or artifact data. Every replay report is labelled saved/stale evidence; unchanged recommendations do not validate current safety. Hashes detect inconsistent saved outputs, not malicious edits to an entire ledger, argument authenticity or upstream provenance. Keep replay files under the same controls as the original internal investigation data.

### Retries And Failures

Public evidence GETs retry HTTP 429/502/503/504 responses, fetch `TypeError` failures and per-request timeout failures at most twice (three attempts total). Every attempt consumes the same external-request budget and is reflected in the usage/retry counters. Authenticated Kondukto calls, ordinary HTTP 401/403/404 responses, parsing/integrity errors, and failures after a response body has begun reading are not retried. The URL allowlist, redirect rejection, byte budgets and credential boundaries still apply to every attempt. Jira and paid model requests do not gain retries.

Retries use 500 ms then 1 second backoff unless `Retry-After` supplies a numeric delay or HTTP date. Retry windows above 30 seconds fail promptly rather than waiting indefinitely or retrying too soon. The investigation's shared cancellation signal also interrupts waits; the next attempt checks remaining budgets and cancellation again. GitHub 403 rate-limit responses are diagnosed as rate limits but not automatically retried.

Terminal failures and failed-tool ledger entries expose safe categories and fixed follow-up guidance: rate limit, authentication, missing resource, unavailable upstream, exhausted budget, cancelled/deadline, invalid report/replay input, missing local release commit, unresolved release mapping, missing repository evidence, network or configuration problems. Unknown failures remain generic. Wrapped causes are inspected, but raw exceptions, upstream bodies and credentials are not printed as normal diagnostics. Opt-in debug mode includes bounded provider error bodies as described below. Missing or failed evidence never establishes non-impact; an incomplete investigation can still produce `needs-investigation` when both repository targets were inspected. Otherwise no comment is proposed for that ticket.

Local budget/provider validation and Jira URL configuration are classified as configuration failures, with safe option names rather than supplied values. Missing local main/explicit-release revisions are repository-evidence failures, not invalid model reports. These stage-specific categories take precedence over wrapped parser or subprocess errors.

### Debugging

For an unknown failure, enable debug diagnostics:

```bash
pnpm triage:vulnerabilities --limit 1 --debug
```

Model HTTP 400 rejections are classified as `model-request`, not `unknown`. Debug causes can include allowlisted `providerCode` and `parameter` fields, plus `mentionedParameters` identifying known request fields mentioned in the provider message. These are diagnostic hints, not proof of which setting caused the rejection. Only JSON error envelopes of at most 32 KiB are inspected for these hints. A rejection does not trigger an inference retry or automatic model fallback.

`--debug` writes `[triage-debug]` JSON events to stderr, leaving JSONL write proposals on stdout unchanged. Step events report the step number, tool-choice policy, finish reason, tool call/error counts, token usage, and whether each repository target has been read. Failure events report at most ten causes using allowlisted error types, HTTP statuses, and network error codes; unknown names and codes are omitted or replaced, and cycles are bounded. SDK API failures also include a `responseBody` preview, including non-JSON gateway errors, capped at 4,096 characters with a `responseBodyTruncated` flag. Preview processing examines at most the first 32,768 characters. Configured secret environment values, JSON credential fields, and common authentication patterns are redacted on a best-effort basis. Request bodies, headers, raw exception messages and stacks are not logged. To capture stderr locally, append `2>triage-debug.log`.

**Debug output may contain sensitive data.** Providers can echo ticket text, source code, prompts or unrecognised credentials in error bodies. Redaction is not a security guarantee: inspect debug events before sharing them, protect local logs, and avoid enabling debug in routine production runs.

Debug mode does not change caching, add retries or relax evidence checks. A live debug run still sends the same approved ticket/code data to the gateway and incurs normal inference costs. Share only inspected debug events when investigating a failure.

### Models

While repository evidence is missing, model steps require tool use and omit the structured response format: the gateway rejects forced tool calls combined with `response_format`. Once both repository targets have been read, the assessment schema is enabled with automatic tool choice; the final allowed step disables tools. Reporting still requires a valid structured assessment and evidence from both targets. This avoids the incompatible request without adding inference calls, retries, or model fallbacks.

`--model auto` is the default. It queries Grove's OpenAI-compatible model catalog and prefers the newest advertised non-experimental, non-vision DeepSeek Flash model. If discovery is unavailable or no Flash model is listed, it selects `claude-sonnet-5` through Grove's Anthropic route. If an auto-selected Flash inference is denied or its route is unavailable (HTTP 403/404), it retries with Sonnet and recomputes the comment fingerprint. Other failures are not silently retried on another model.

```bash
pnpm triage:vulnerabilities --list-models
pnpm triage:vulnerabilities --model claude-sonnet-5
pnpm triage:vulnerabilities --model YOUR_GROVE_MODEL_ID --provider openai
```

`TRIAGE_MODEL` also sets the model. The provider is inferred as Anthropic for `claude-*` and OpenAI-compatible otherwise; `--provider anthropic|openai` overrides this only with an explicit model. Explicit selections do not silently fall back. Catalog availability does not guarantee your team key can invoke a given model. The default Sonnet ID is configurable because gateway offerings and key permissions change; live access must be verified with your own key.

### Comment Ownership And Caching

Proposed comments contain YAML frontmatter with an automation marker and a SHA-256 hash, followed by the human-review report rendered from the checked assessment. A comment is owned only if its marker matches this script and its author matches Jira's authenticated identity. Unrelated or other users' comments are never adopted. Multiple matching comments require manual reconciliation.

The hash covers the ticket fields, system and investigation prompts, assessment instructions/schema, model/provider, inference limits, harness version, Jira URL, pinned main/release commits, the release provenance label, and the current UTC day. Automatic latest-release discovery runs before cache comparison, so a newly published version invalidates the cache immediately. The daily component causes advisory/dependency evidence to be revisited rather than caching mutable advisories indefinitely; advisory changes within the same day do not automatically invalidate an existing comment. A matching existing comment skips inference and advisory/dependency evidence reads. A stale owned comment produces a PUT proposal; no owned comment produces a POST proposal. Comments are fully paginated before deciding. Model/API failures leave existing comments untouched; unavailable external evidence is explicitly marked incomplete.

Dry-run output is not persisted as a cache. Until an owned comment actually exists in Jira, repeating a run repeats the investigation and model costs. Use the same Jira identity across runs to recognize previously authored comments.

### Validation

```bash
pnpm exec vitest run --project scripts --coverage.enabled false packages/scripts/src/vulnerabilityTriage.test.ts
pnpm --filter @mongodb-js/mcp-scripts check
```

Tests intercept Jira, Grove, GitHub advisory, and npm HTTP calls while exercising the actual AI SDK tool loop. No real credentials or paid inference are needed. They verify GET-only Jira access, pagination, cache invalidation and ownership, dual-target repository reads and graph queries, workspace/alias/peer/optional/dev resolution, cycles and incomplete graphs, product artifact inventory, concurrent archive reuse, registry/lockfile integrity, configurable budgets, external evidence and credential isolation, model fallback, structured human-advisory reports, citation/target checks, version-range consistency, failed-call ledgers, printed create/update requests, and failure handling. These tests are not a real-ticket accuracy benchmark or proof of exploitability. A real production dry run and human-reviewed accuracy evaluation remain separate validation steps using approved credentials and independently adjudicated outcomes; prior human triage must not be supplied as model evidence.
