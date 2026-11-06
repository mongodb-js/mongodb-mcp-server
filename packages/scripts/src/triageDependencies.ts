import { posix } from "node:path";
import { parse } from "yaml";
import { z } from "zod/v4";

const referenceSchema = z.union([z.string(), z.object({ version: z.string() })]);
const dependenciesSchema = z.record(z.string(), referenceSchema).default({});
const importerSchema = z.object({
    dependencies: dependenciesSchema,
    optionalDependencies: dependenciesSchema,
    devDependencies: dependenciesSchema,
});
const lockSchema = z.object({
    lockfileVersion: z
        .union([z.string(), z.number()])
        .refine((value) => String(value) === "9" || String(value) === "9.0", "Only pnpm v9 lockfiles are supported"),
    importers: z.record(z.string(), importerSchema),
    snapshots: z.record(z.string(), importerSchema),
    packages: z
        .record(
            z.string(),
            z.object({
                resolution: z.object({ integrity: z.string().optional(), tarball: z.string().optional() }).optional(),
                peerDependencies: z.record(z.string(), z.string()).optional(),
                os: z.array(z.string()).optional(),
                cpu: z.array(z.string()).optional(),
                libc: z.array(z.string()).optional(),
            })
        )
        .default({}),
    patchedDependencies: z.record(z.string(), z.unknown()).default({}),
    overrides: z.record(z.string(), z.string()).default({}),
});

type GraphNode = {
    id: string;
    name: string;
    version?: string;
    importer?: string;
    integrity?: string;
    tarball?: string;
    patch?: unknown;
    conditions?: { os?: string[]; cpu?: string[]; libc?: string[] };
};
type GraphEdge = { from: string; to: string; requestedAs: string; kind: "dependency" | "optional" | "dev" | "peer" };
export type DependencyPathReport = {
    roots: string[];
    importers: string[];
    occurrences: GraphNode[];
    nodes: GraphNode[];
    paths: { nodes: string[]; edges: GraphEdge[] }[];
    graphNodes: number;
    graphEdges: number;
    resolutionComplete: boolean;
    pathsTruncated: boolean;
    gaps: string[];
    overrides: Record<string, string>;
    limitations: string[];
};

export class PnpmDependencyGraph {
    private readonly lock: z.infer<typeof lockSchema>;
    private readonly manifests: Record<string, { name: string; version?: string }>;

    constructor(lockfile: string, manifests: Record<string, { name: string; version?: string }> = {}) {
        this.lock = lockSchema.parse(parse(lockfile, { maxAliasCount: 50, uniqueKeys: true }));
        this.manifests = manifests;
    }

    paths(input: { name: string; importer: string; includeDev?: boolean; maxPaths?: number }): DependencyPathReport {
        z.string().min(1).max(214).parse(input.name);
        const maxPaths = z
            .number()
            .int()
            .min(1)
            .max(100)
            .parse(input.maxPaths ?? 25);
        const importers = Object.keys(this.lock.importers).sort();
        const selected = input.importer === "*" ? importers : [input.importer];
        if (selected.some((importer) => !this.lock.importers[importer]))
            throw new Error("Unknown pnpm importer; use an importer path from the lockfile or * for all importers");
        const nodes = new Map<string, GraphNode>();
        const edges = new Map<string, GraphEdge[]>();
        const pending: string[] = [];
        const gaps = new Set<string>();
        const roots = selected.map((importer) => `root:${importer}`);
        let edgeCount = 0;
        const add = (node: GraphNode): void => {
            if (nodes.has(node.id)) return;
            if (nodes.size >= 50_000) {
                gaps.add("Graph node budget exceeded");
                return;
            }
            nodes.set(node.id, node);
            pending.push(node.id);
        };
        const workspace = (importer: string, root: boolean): GraphNode => ({
            id: `${root ? "root" : "workspace"}:${importer}`,
            importer,
            name: this.manifests[importer]?.name ?? importer,
            version: this.manifests[importer]?.version,
        });
        for (const importer of selected) add(workspace(importer, true));
        for (let cursor = 0; cursor < pending.length; cursor++) {
            const id = pending[cursor];
            if (!id) continue;
            const parent = nodes.get(id);
            if (!parent) continue;
            const source =
                parent.importer !== undefined ? this.lock.importers[parent.importer] : this.lock.snapshots[id];
            if (!source) {
                gaps.add(`Missing snapshot/importer: ${id}`);
                continue;
            }
            const groups: { values: z.infer<typeof dependenciesSchema>; kind: GraphEdge["kind"] }[] = [
                { values: source.dependencies, kind: "dependency" },
                { values: source.optionalDependencies, kind: "optional" },
            ];
            if (id.startsWith("root:") && input.includeDev)
                groups.push({ values: source.devDependencies, kind: "dev" });
            for (const group of groups)
                for (const [alias, value] of Object.entries(group.values).sort(([first], [second]) =>
                    first.localeCompare(second)
                )) {
                    const reference = typeof value === "string" ? value : value.version;
                    let child: GraphNode;
                    if (reference.startsWith("link:")) {
                        if (parent.importer === undefined) {
                            gaps.add(`Cannot resolve link ${alias}=${reference} from ${id}`);
                            continue;
                        }
                        const importer = posix.normalize(posix.join(parent.importer, reference.slice(5)));
                        if (!this.lock.importers[importer]) {
                            gaps.add(`Missing workspace importer ${importer} from ${id}`);
                            continue;
                        }
                        child = workspace(importer, false);
                    } else {
                        const candidates = [`${alias}@${reference}`, reference.replace(/^npm:/, "")];
                        const key = candidates.find((candidate) => this.lock.snapshots[candidate] !== undefined);
                        if (!key) {
                            gaps.add(`Unresolved dependency ${id} -> ${alias}=${reference}`);
                            continue;
                        }
                        const bareKey = key.replace(/\(.*/, "");
                        const identity = /^(@[^/]+\/[^@]+|[^@]+)@(.+)$/.exec(bareKey);
                        if (!identity?.[1] || !identity[2]) {
                            gaps.add(`Unsupported package identity ${key}`);
                            continue;
                        }
                        const metadata = this.lock.packages[bareKey];
                        if (!metadata) gaps.add(`Missing package metadata for ${key}`);
                        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(identity[2]))
                            gaps.add(`Non-registry resolution requires separate source evidence: ${key}`);
                        child = {
                            id: key,
                            name: identity[1],
                            version: identity[2],
                            integrity: metadata?.resolution?.integrity,
                            tarball: metadata?.resolution?.tarball,
                            patch:
                                this.lock.patchedDependencies[bareKey] ??
                                (key.includes("patch_hash=")
                                    ? "Patched snapshot; inspect its patch separately"
                                    : undefined),
                            conditions: { os: metadata?.os, cpu: metadata?.cpu, libc: metadata?.libc },
                        };
                    }
                    add(child);
                    if (!nodes.has(child.id)) continue;
                    if (++edgeCount > 100_000) {
                        gaps.add("Graph edge budget exceeded");
                        continue;
                    }
                    const list = edges.get(id) ?? [];
                    const parentMetadata = this.lock.packages[id.replace(/\(.*/, "")];
                    list.push({
                        from: id,
                        to: child.id,
                        requestedAs: alias,
                        kind:
                            group.kind === "dependency" && parentMetadata?.peerDependencies?.[alias]
                                ? "peer"
                                : group.kind,
                    });
                    edges.set(id, list);
                }
        }
        const occurrences = [...nodes.values()].filter((node) => node.name === input.name);
        const ancestors = new Set(occurrences.map((node) => node.id));
        const reverse = new Map<string, string[]>();
        for (const [parent, children] of edges)
            for (const child of children) reverse.set(child.to, [...(reverse.get(child.to) ?? []), parent]);
        const queue = [...ancestors];
        for (let cursor = 0; cursor < queue.length; cursor++)
            for (const parent of reverse.get(queue[cursor] ?? "") ?? []) {
                if (!ancestors.has(parent)) {
                    ancestors.add(parent);
                    queue.push(parent);
                }
            }
        const paths: DependencyPathReport["paths"] = [];
        const stack = roots
            .filter((root) => ancestors.has(root))
            .map((root) => ({ nodes: [root], edges: [] as GraphEdge[] }));
        let expanded = 0;
        let pathsTruncated = false;
        while (stack.length) {
            if (++expanded > 100_000 || paths.length >= maxPaths) {
                pathsTruncated = true;
                break;
            }
            const path = stack.pop();
            if (!path) break;
            const last = path.nodes[path.nodes.length - 1];
            if (!last) continue;
            if (nodes.get(last)?.name === input.name) paths.push(path);
            if (path.nodes.length >= 100) {
                pathsTruncated = true;
                continue;
            }
            for (const edge of edges.get(last) ?? [])
                if (ancestors.has(edge.to) && !path.nodes.includes(edge.to))
                    stack.push({ nodes: [...path.nodes, edge.to], edges: [...path.edges, edge] });
        }
        const shown = new Set([...paths.flatMap((path) => path.nodes), ...occurrences.map((node) => node.id)]);
        return {
            roots,
            importers,
            occurrences,
            nodes: [...nodes.values()].filter((node) => shown.has(node.id)),
            paths,
            graphNodes: nodes.size,
            graphEdges: edgeCount,
            resolutionComplete: !gaps.size,
            pathsTruncated,
            gaps: [...gaps],
            overrides: this.lock.overrides,
            limitations: [
                "Pinned pnpm v9 lockfile resolution, NOT a call graph or proof of shipped dependencies. No installs or code execution.",
                "Optional/platform-dependent edges are retained, not assumed active. includeDev includes selected root importers' dev dependencies only.",
                "Peer variants retain distinct snapshot identities. Overrides use already-resolved lockfile values. Patched packages require separate patch/source inspection.",
                "Missing package paths establish absence only within a complete selected lockfile graph, not in bundles, native modules, other package managers, or the shipped artifact.",
            ],
        };
    }
}
