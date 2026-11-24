import fs from "fs";
import path from "path";
import type { CycloneDxComponent, LicenseFile } from "./types.js";

const LICENSE_FILE_NAMES = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENSE-MIT",
    "LICENSE-APACHE",
    "LICENSE.BSD",
    "COPYING",
    "COPYING.md",
];

export function getLicenses(component: CycloneDxComponent): string[] {
    return (component.licenses ?? []).flatMap((entry) => {
        const license = entry.license?.id ?? entry.license?.name ?? entry.expression;
        return license ? [license] : [];
    });
}

// pnpm's virtual store dir is `<name>@<version>` or `<name>@<version>_<peers>_<hash>`. The `{,_*}`
// keeps the version anchored so a prefix can't match a longer version (e.g. 1.2.3 vs 1.2.30).
function packageStoreGlob(packageName: string, version: string): string {
    const escapedName = packageName.replace(/\//g, "+");
    return `node_modules/.pnpm/${escapedName}@${version}{,_*}/node_modules/${packageName}`;
}

export function findPackagePath(packageName: string, version: string): string | undefined {
    const rootPath = path.join(process.cwd(), "node_modules", packageName);
    if (fs.existsSync(rootPath)) {
        return rootPath;
    }

    const [match] = fs.globSync(packageStoreGlob(packageName, version));
    return match ? path.resolve(match) : undefined;
}

export function findLicenseFiles(packagePath: string): LicenseFile[] {
    return LICENSE_FILE_NAMES.flatMap((filename) => {
        const filePath = path.join(packagePath, filename);
        return fs.existsSync(filePath) ? [{ filename, content: fs.readFileSync(filePath, "utf-8") }] : [];
    });
}

const MONOREPO_ROOT = path.join(import.meta.dirname, "../../../../");

// Resolves a package's license from its installed package.json. Needed because
// `pnpm sbom --lockfile-only` omits license metadata.
export function findPackageLicense(packageName: string, version: string): string[] {
    const candidates = [
        path.join(MONOREPO_ROOT, "node_modules", packageName),
        ...fs.globSync(path.join(MONOREPO_ROOT, packageStoreGlob(packageName, version))),
    ];
    for (const dir of candidates) {
        const packageJsonPath = path.join(dir, "package.json");
        if (!fs.existsSync(packageJsonPath)) continue;
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
            license?: string;
            licenses?: { type?: string }[];
        };
        if (typeof pkg.license === "string") return [pkg.license];
        if (Array.isArray(pkg.licenses)) {
            return pkg.licenses.flatMap((entry) => (typeof entry?.type === "string" ? [entry.type] : []));
        }
    }
    return [];
}
