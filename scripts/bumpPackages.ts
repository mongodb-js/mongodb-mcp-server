#!/usr/bin/env tsx

/**
 * Bumps workspace package versions using conventional commits.
 *
 * Usage:
 *   tsx scripts/bumpPackages.ts                                            # auto-bump packages/* based on commits
 *   tsx scripts/bumpPackages.ts --filter @mongodb-js/mcp-metrics           # auto-bump only specific packages
 *   tsx scripts/bumpPackages.ts --override mongodb-mcp-server:patch        # bump root by patch, auto-bump rest
 *   tsx scripts/bumpPackages.ts --override mongodb-mcp-server:1.2.3        # set root to exact version, auto-bump rest
 *   tsx scripts/bumpPackages.ts --override mongodb-mcp-server:minor --filter .  # only bump root by minor
 */

import { execSync } from "child_process";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import semver from "semver";
import type { ReleaseType } from "semver";
import { z } from "zod";

export const BUMP_COMMIT_PREFIX = "chore: bump auxiliary packages";
const ROOT = join(import.meta.dirname, "..");

const BUMP_ORDER: Record<string, number> = { major: 3, minor: 2, patch: 1 };

export function getBumpFromCommit(subject: string): ReleaseType {
    if (/^.*!:/.test(subject) || /BREAKING CHANGE/.test(subject)) {
        return "major";
    }
    if (/^feat(\(.*\))?:/.test(subject)) {
        return "minor";
    }
    return "patch";
}

export function maxBump(a: ReleaseType | null, b: ReleaseType | null): ReleaseType | null {
    const aVal = a ? (BUMP_ORDER[a] ?? 0) : 0;
    const bVal = b ? (BUMP_ORDER[b] ?? 0) : 0;
    return aVal >= bVal ? a : b;
}

const overrideSchema = z.string().transform((val, ctx) => {
    const colonIdx = val.lastIndexOf(":");
    if (colonIdx <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid override "${val}", expected "name:version"` });
        return z.NEVER;
    }
    return { name: val.slice(0, colonIdx), version: val.slice(colonIdx + 1) };
});

const argsSchema = z.object({
    filters: z.array(z.string()).default([]),
    overrides: z.array(overrideSchema).default([]),
});

export type ParsedArgs = z.infer<typeof argsSchema>;

export function parseArgs(argv: string[]): ParsedArgs {
    const raw: { filters: string[]; overrides: string[] } = { filters: [], overrides: [] };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--filter" && i + 1 < argv.length) {
            i++;
            raw.filters.push(argv[i] as string);
        } else if (arg === "--override" && i + 1 < argv.length) {
            i++;
            raw.overrides.push(argv[i] as string);
        }
    }

    return argsSchema.parse(raw);
}

export interface PackageInfo {
    name: string;
    version: string;
    dir: string;
    packageJsonPath: string;
    isRoot: boolean;
}

function getRootPackage(): PackageInfo {
    const packageJsonPath = join(ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name: string; version: string };
    return { name: pkg.name, version: pkg.version, dir: ".", packageJsonPath, isRoot: true };
}

function getSubPackages(): PackageInfo[] {
    const packagesDir = join(ROOT, "packages");
    let entries: string[];
    try {
        entries = readdirSync(packagesDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    } catch {
        return [];
    }

    return entries
        .map((name) => {
            const packageJsonPath = join(packagesDir, name, "package.json");
            try {
                const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
                    name: string;
                    version: string;
                };
                return {
                    name: pkg.name,
                    version: pkg.version,
                    dir: `packages/${name}`,
                    packageJsonPath,
                    isRoot: false,
                };
            } catch {
                return null;
            }
        })
        .filter((p): p is PackageInfo => p !== null);
}

function getPackages({ filters, overrideNames }: { filters: string[]; overrideNames: string[] }): PackageInfo[] {
    const all = [getRootPackage(), ...getSubPackages()];

    if (filters.length === 0 && overrideNames.length === 0) {
        return all.filter((pkg) => !pkg.isRoot);
    }

    if (filters.length === 0) {
        const targeted = new Set(overrideNames);
        return all.filter((pkg) => targeted.has(pkg.name) || !pkg.isRoot);
    }

    return all.filter((pkg) => filters.includes(pkg.name) || (filters.includes(".") && pkg.isRoot));
}

function getLastBumpCommit(): string | undefined {
    try {
        const sha = execSync(`git log --all --grep="${BUMP_COMMIT_PREFIX}" --format=%H -1`, {
            cwd: ROOT,
            encoding: "utf-8",
        }).trim();
        return sha || undefined;
    } catch {
        return undefined;
    }
}

function getCommitsForPath({ dir, since }: { dir: string; since?: string }): string[] {
    const range = since ? `${since}..HEAD` : "HEAD";
    try {
        const output = execSync(`git log ${range} --format=%s -- "${dir}"`, {
            cwd: ROOT,
            encoding: "utf-8",
        }).trim();
        return output ? output.split("\n") : [];
    } catch {
        return [];
    }
}

function updatePackageInfo(version: string): void {
    const packageJsonPath = join(ROOT, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
        engines?: { node?: string };
    };
    const nodeEngine = packageJson.engines?.node ?? ">=20.0.0";

    const content = `// This file was generated by scripts/bumpPackages.ts - Do not edit it manually.
export const packageInfo: {
    version: string;
    mcpServerName: string;
    engines: { node: string };
} = {
    version: "${version}",
    mcpServerName: "MongoDB MCP Server",
    engines: {
        node: "${nodeEngine}",
    },
};
`;

    writeFileSync(join(ROOT, "src", "common", "packageInfo.ts"), content);
}

export interface BumpResult {
    name: string;
    oldVersion: string;
    newVersion: string;
    bump: ReleaseType | "explicit";
    commits: number;
}

const RELEASE_TYPES = ["major", "minor", "patch", "premajor", "preminor", "prepatch", "prerelease"];

function resolveExplicitVersion({ pkg, version }: { pkg: PackageInfo; version: string }): BumpResult | null {
    if (RELEASE_TYPES.includes(version)) {
        const bump = version as ReleaseType;
        const newVersion = semver.inc(pkg.version, bump);
        if (!newVersion) {
            console.error(`${pkg.name}: failed to increment ${pkg.version} by ${bump}`);
            return null;
        }
        return { name: pkg.name, oldVersion: pkg.version, newVersion, bump, commits: 0 };
    }

    if (!semver.valid(version)) {
        console.error(`${pkg.name}: invalid version "${version}"`);
        return null;
    }
    return { name: pkg.name, oldVersion: pkg.version, newVersion: version, bump: "explicit", commits: 0 };
}

function resolveConventionalVersion({ pkg, since }: { pkg: PackageInfo; since?: string }): BumpResult | null {
    const commits = getCommitsForPath({ dir: pkg.dir, since });
    if (commits.length === 0) {
        console.log(`${pkg.name}: no changes since last bump, skipping`);
        return null;
    }

    let bump: ReleaseType | null = null;
    for (const subject of commits) {
        bump = maxBump(bump, getBumpFromCommit(subject));
    }

    if (!bump) {
        return null;
    }

    const newVersion = semver.inc(pkg.version, bump);
    if (!newVersion) {
        console.error(`${pkg.name}: failed to increment ${pkg.version} by ${bump}`);
        return null;
    }

    return { name: pkg.name, oldVersion: pkg.version, newVersion, bump, commits: commits.length };
}

function main(): BumpResult[] {
    const { filters, overrides } = parseArgs(process.argv.slice(2));
    const overrideMap = new Map(overrides.map((o) => [o.name, o.version]));

    const packages = getPackages({ filters, overrideNames: [...overrideMap.keys()] });

    if (packages.length === 0) {
        console.log("No packages matched.");
        return [];
    }

    const lastBumpSha = getLastBumpCommit();
    if (lastBumpSha) {
        console.log(`Last bump commit: ${lastBumpSha}`);
    } else {
        console.log("No previous bump commit found, scanning all history");
    }

    const results: BumpResult[] = [];
    let hasError = false;

    for (const pkg of packages) {
        const override = overrideMap.get(pkg.name);
        const result = override
            ? resolveExplicitVersion({ pkg, version: override })
            : resolveConventionalVersion({ pkg, since: lastBumpSha });

        if (!result) {
            if (override) {
                hasError = true;
            }
            continue;
        }

        if (result.newVersion === pkg.version) {
            console.log(`${pkg.name}: already at ${pkg.version}, skipping`);
            continue;
        }

        console.log(
            `${pkg.name}: ${pkg.version} → ${result.newVersion} (${result.bump}${result.commits ? `, ${result.commits} commit(s)` : ""})`
        );

        const packageJson = JSON.parse(readFileSync(pkg.packageJsonPath, "utf-8")) as { version: string };
        packageJson.version = result.newVersion;
        writeFileSync(pkg.packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n", "utf-8");

        if (pkg.isRoot) {
            updatePackageInfo(result.newVersion);
        }

        results.push(result);
    }

    if (hasError) {
        process.exitCode = 1;
    }

    return results;
}

const results = main();

if (results.length === 0) {
    console.log("\nNo packages to bump.");
} else {
    const summary = results.map((r) => `${r.name}@${r.newVersion}`).join(", ");
    console.log(`\nBumped: ${summary}`);
}
