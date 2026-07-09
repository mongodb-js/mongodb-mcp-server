import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { findLicenseFiles, findPackagePath, getLicenses } from "./licenses.js";
import type { Conversion, CycloneDxBom, CycloneDxComponent, DependencyWithLicense } from "./types.js";

export const CONVERSIONS: Conversion[] = [
    { prod: false, outputPath: ".sbom/dependencies.json" },
    { prod: true, outputPath: ".sbom/dependencies-prod.json" },
];

function dependencyKey(dependency: DependencyWithLicense): string {
    return `${dependency.name}@${dependency.version}`;
}

function dedupeAndSort(dependencies: DependencyWithLicense[]): DependencyWithLicense[] {
    const uniqueByKey = new Map(dependencies.map((dependency) => [dependencyKey(dependency), dependency]));
    return Array.from(uniqueByKey.values()).sort((a, b) => dependencyKey(a).localeCompare(dependencyKey(b)));
}

function getFullPackageName(component: CycloneDxComponent): string {
    return component.group ? `${component.group}/${component.name}` : component.name;
}

function enrichComponent(component: CycloneDxComponent): DependencyWithLicense {
    const name = getFullPackageName(component);
    const version = component.version;

    const licenses = getLicenses(component);
    const packagePath = findPackagePath(name, version);
    const licenseFiles = packagePath ? findLicenseFiles(packagePath) : [];

    return {
        name,
        version,
        ...(licenses[0] ? { license: licenses[0] } : {}),
        ...(licenses.length > 1 ? { licenses } : {}),
        ...(packagePath ? { path: packagePath } : {}),
        ...(licenseFiles.length > 0 ? { licenseFiles } : {}),
    };
}

function generateSbom(prod: boolean): CycloneDxBom {
    const flags = prod ? " --prod" : "";
    const output = execSync(`pnpm sbom --sbom-format cyclonedx${flags}`, {
        encoding: "utf-8",
        maxBuffer: 1024 * 1024 * 100,
        stdio: ["ignore", "pipe", "inherit"],
    });
    return JSON.parse(output) as CycloneDxBom;
}

export function convertSbomToDependencyList(conversion: Conversion): void {
    const sbom = generateSbom(conversion.prod);
    const components = (sbom.components ?? []).filter((component) => component.name && component.version);

    const enrichedDependencies = dedupeAndSort(components.map(enrichComponent));

    fs.mkdirSync(path.dirname(conversion.outputPath), { recursive: true });
    fs.writeFileSync(conversion.outputPath, JSON.stringify(enrichedDependencies, null, 2));
}
