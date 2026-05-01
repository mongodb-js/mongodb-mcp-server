#!/usr/bin/env node
// Run with: node scripts/createMcpb.ts [--validate-only]
// Erasable TS only: no enum/namespace/parameter-properties/decorators.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { PackageJson as LoosePackageJson, SetRequired } from "type-fest";

type PackageJson = SetRequired<LoosePackageJson, "name" | "version" | "dependencies">;

function spawnAsync(cmd: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
        child.on("error", rejectPromise);
        child.on("exit", (code) => {
            if (code === 0) {
                resolvePromise();
            } else {
                rejectPromise(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
            }
        });
    });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

type Mode = "build" | "validate-only";

const paths = {
    repoRoot,
    distEsm: resolve(repoRoot, "dist", "esm"),
    rootPackageJson: resolve(repoRoot, "package.json"),
    packagingDir: resolve(repoRoot, "packaging", "mcpb"),
    stagingDir: resolve(repoRoot, "mcpb-build"),
    outputDir: resolve(repoRoot, "dist-mcpb"),
} as const;

type WorkspacePackage = { name: string; dir: string };

function parseWorkspaceGlobs(yaml: string): string[] {
    // Simple parser: find a line starting with `packages:`, collect subsequent
    // `  - "..."` (or `  - '...'`) entries until the indentation changes.
    const lines = yaml.split(/\r?\n/);
    const globs: string[] = [];
    let inPackages = false;
    for (const raw of lines) {
        if (/^packages:\s*$/.test(raw)) {
            inPackages = true;
            continue;
        }
        if (inPackages) {
            const match = raw.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
            if (match && match[1]) {
                globs.push(match[1]);
            } else if (/^\S/.test(raw)) {
                // Top-level key reached; stop.
                break;
            }
        }
    }
    return globs;
}

function expandGlob(globPattern: string): string[] {
    // Only supports a trailing /* — sufficient for this repo.
    if (globPattern.endsWith("/*")) {
        const parent = resolve(paths.repoRoot, globPattern.slice(0, -2));
        if (!existsSync(parent)) return [];
        return readdirSync(parent, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => resolve(parent, d.name));
    }
    // Literal directory.
    const literal = resolve(paths.repoRoot, globPattern);
    return existsSync(literal) ? [literal] : [];
}

function discoverWorkspacePackages(rootPkg: PackageJson): WorkspacePackage[] {
    // Collect names of root deps that use `workspace:*` (or any `workspace:` protocol).
    const all = { ...(rootPkg.dependencies ?? {}), ...(rootPkg.optionalDependencies ?? {}) };
    const workspaceNames = new Set(
        Object.entries(all)
            .filter(([, v]) => typeof v === "string" && v.startsWith("workspace:"))
            .map(([k]) => k)
    );
    if (workspaceNames.size === 0) return [];

    // Read pnpm-workspace.yaml to find the package globs.
    const wsYamlPath = resolve(paths.repoRoot, "pnpm-workspace.yaml");
    const wsYaml = readFileSync(wsYamlPath, "utf8");
    const globs = parseWorkspaceGlobs(wsYaml);

    // For each glob, expand to package directories and read each package.json.
    const found: WorkspacePackage[] = [];
    for (const globPattern of globs) {
        for (const pkgDir of expandGlob(globPattern)) {
            const pkgJsonPath = resolve(pkgDir, "package.json");
            if (!existsSync(pkgJsonPath)) continue;
            const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as PackageJson;
            if (pkgJson.name && workspaceNames.has(pkgJson.name)) {
                found.push({ name: pkgJson.name, dir: pkgDir });
            }
        }
    }

    // Sanity check: every workspace dep must be found.
    const foundNames = new Set(found.map((p) => p.name));
    const missing = [...workspaceNames].filter((n) => !foundNames.has(n));
    if (missing.length > 0) {
        throw new Error(`Could not locate workspace packages in pnpm-workspace.yaml globs: ${missing.join(", ")}`);
    }
    return found;
}

export const ATLAS_LOCAL_PLATFORM_PACKAGES = [
    "@mongodb-js/atlas-local-darwin-arm64",
    "@mongodb-js/atlas-local-darwin-x64",
    "@mongodb-js/atlas-local-linux-x64-gnu",
    "@mongodb-js/atlas-local-linux-arm64-gnu",
    "@mongodb-js/atlas-local-win32-x64-msvc",
] as const;

export function buildStagingPackageJson(rootPkg: PackageJson): PackageJson {
    const dependencies = { ...(rootPkg.dependencies ?? {}) } as Record<string, string>;
    const optionalDependencies = { ...(rootPkg.optionalDependencies ?? {}) } as Record<string, string>;

    const atlasLocalRange = dependencies["@mongodb-js/atlas-local"] ?? optionalDependencies["@mongodb-js/atlas-local"];
    if (!atlasLocalRange) {
        throw new Error("Expected @mongodb-js/atlas-local to be a (optional) dependency of the root package.");
    }
    // Strip semver range prefix; the platform packages publish exact versions matched to the parent.
    const exactVersion = atlasLocalRange.replace(/^[~^]/, "");
    for (const pkg of ATLAS_LOCAL_PLATFORM_PACKAGES) {
        dependencies[pkg] = exactVersion;
    }

    return {
        name: "mongodb-mcp-server-mcpb-staging",
        version: rootPkg.version,
        private: true,
        type: "module",
        dependencies,
        optionalDependencies,
    };
}

async function stageFiles(): Promise<void> {
    if (!existsSync(paths.distEsm)) {
        throw new Error(
            `dist/esm not found at ${paths.distEsm}. Run \`pnpm run build\` before \`pnpm run build:mcpb\`.`
        );
    }

    await rm(paths.stagingDir, { recursive: true, force: true });
    // Mirror packaging/mcpb → mcpb-build (manifest.json, icon.png, server/index.js)
    await cp(paths.packagingDir, paths.stagingDir, { recursive: true });
    // Add the runtime dist next to server/index.js
    await cp(paths.distEsm, resolve(paths.stagingDir, "server", "dist"), { recursive: true });
}

async function runMcpbValidate(): Promise<void> {
    // pnpm exec changes cwd to the workspace root, so we pass an absolute manifest path.
    const manifestPath = resolve(paths.stagingDir, "manifest.json");
    await spawnAsync("pnpm", ["exec", "mcpb", "validate", manifestPath], paths.stagingDir);
}

async function stageDependencies(rootPkg: PackageJson): Promise<void> {
    const stagingPkg = buildStagingPackageJson(rootPkg);
    const workspacePkgs = discoverWorkspacePackages(rootPkg);

    // Rewrite workspace:* refs to file:<absolute-path>. pnpm install will read each
    // package's own package.json for transitives and install them.
    for (const ws of workspacePkgs) {
        if (ws.name in stagingPkg.dependencies) {
            stagingPkg.dependencies[ws.name] = `file:${ws.dir}`;
        }
        if (stagingPkg.optionalDependencies && ws.name in stagingPkg.optionalDependencies) {
            stagingPkg.optionalDependencies[ws.name] = `file:${ws.dir}`;
        }
    }

    await writeFile(resolve(paths.stagingDir, "package.json"), JSON.stringify(stagingPkg, null, 2) + "\n");

    await spawnAsync(
        "pnpm",
        [
            "install",
            "--prod",
            "--ignore-workspace",
            "--node-linker=hoisted",
            "--config.supported-architectures.os={darwin,linux,win32}",
            "--config.supported-architectures.cpu={x64,arm64}",
        ],
        paths.stagingDir
    );

    // Kerberos returns transitively via @mongodb-js/devtools-connect. Strip it.
    const kerberosDir = resolve(paths.stagingDir, "node_modules", "kerberos");
    if (existsSync(kerberosDir)) {
        await rm(kerberosDir, { recursive: true, force: true });
    }

    // Replace the staging package.json with a minimal runtime one. Only `type: "module"`
    // affects Node's runtime behavior (ESM parsing for server/index.js).
    await writeFile(
        resolve(paths.stagingDir, "package.json"),
        JSON.stringify(
            {
                name: "mongodb-mcp-server-mcpb",
                version: rootPkg.version,
                private: true,
                type: "module",
            },
            null,
            2
        )
    );
}

function verifyStagedDeps(): void {
    const stagingNodeModules = resolve(paths.stagingDir, "node_modules");

    // Required: every atlas-local platform package.
    const missing = ATLAS_LOCAL_PLATFORM_PACKAGES.filter(
        (pkg) => !existsSync(resolve(stagingNodeModules, ...pkg.split("/")))
    );

    if (missing.length > 0) {
        throw new Error(
            `mcpb: missing required platform packages in staging node_modules:\n  - ${missing.join("\n  - ")}`
        );
    }

    // Sanity check: stageDependencies removes kerberos post-install as it's platform-specific and
    // we there's no way to add it for all platforms.
    if (existsSync(resolve(stagingNodeModules, "kerberos"))) {
        throw new Error(
            "mcpb: kerberos was installed in the staging tree but the bundle is supposed to exclude it. Investigate which package re-pulled it."
        );
    }

    console.log(
        `mcpb: verified ${ATLAS_LOCAL_PLATFORM_PACKAGES.length} atlas-local platform packages present, kerberos absent.`
    );
}

async function packMcpb(rootPkg: PackageJson): Promise<void> {
    await mkdir(paths.outputDir, { recursive: true });
    const outFile = resolve(paths.outputDir, `mongodb-mcp-server-${rootPkg.version}.mcpb`);
    await spawnAsync("pnpm", ["exec", "mcpb", "pack", paths.stagingDir, outFile], paths.repoRoot);
    const s = await stat(outFile);
    const mb = (s.size / (1024 * 1024)).toFixed(1);
    console.log(`mcpb: wrote ${outFile} (${mb} MB)`);
    if (s.size > 200 * 1024 * 1024) {
        console.warn(
            `mcpb: warning: artifact is larger than 200 MB (${mb} MB). Revisit prune list or per-platform builds.`
        );
    }
}

async function main(): Promise<void> {
    const mode: Mode = process.argv.includes("--validate-only") ? "validate-only" : "build";
    const rootPkg = JSON.parse(readFileSync(paths.rootPackageJson, "utf8")) as PackageJson;

    console.log(`mcpb build: mode=${mode}, version=${rootPkg.version}`);
    await stageFiles();
    console.log("mcpb: staged manifest, dist, icon");

    if (mode === "validate-only") {
        await runMcpbValidate();
        console.log("mcpb: validate-only mode — done.");
        return;
    }

    await stageDependencies(rootPkg);
    verifyStagedDeps();
    await packMcpb(rootPkg);
    console.log("mcpb: build complete.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
