import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { findLicenseFiles, findPackagePath, getLicenses } from "./licenses.js";
import type { Conversion, CycloneDxBom, CycloneDxComponent, DependencyWithLicense } from "./types.js";

export const CONVERSIONS: Conversion[] = [
    { prod: false, outputPath: ".sbom/dependencies.json", rawOutputPath: ".sbom/sbom.cyclonedx.json" },
    { prod: true, outputPath: ".sbom/dependencies-prod.json", rawOutputPath: ".sbom/sbom-prod.cyclonedx.json" },
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
    // Pin to CycloneDX 1.6: silkbomb 2.0 validates schemas for 1.2-1.6 only.
    // pnpm's default is 1.7, which silkbomb skips validation for (warning +
    // proceeds unvalidated). 1.6 is the newest spec silkbomb fully supports.
    const output = execSync(`pnpm sbom --sbom-format cyclonedx --sbom-spec-version 1.6${flags}`, {
        encoding: "utf-8",
        maxBuffer: 1024 * 1024 * 100,
        stdio: ["ignore", "pipe", "inherit"],
    });
    return JSON.parse(output) as CycloneDxBom;
}

export function convertSbomToDependencyList(conversion: Conversion): void {
    const sbom = generateSbom(conversion.prod);

    fs.mkdirSync(path.dirname(conversion.rawOutputPath), { recursive: true });
    fs.writeFileSync(conversion.rawOutputPath, JSON.stringify(sbom, null, 2));

    const components = (sbom.components ?? []).filter((component) => component.name && component.version);

    const enrichedDependencies = dedupeAndSort(components.map(enrichComponent));

    fs.mkdirSync(path.dirname(conversion.outputPath), { recursive: true });
    fs.writeFileSync(conversion.outputPath, JSON.stringify(enrichedDependencies, null, 2));
}
