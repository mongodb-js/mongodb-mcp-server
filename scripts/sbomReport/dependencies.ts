import fs from "fs";
import path from "path";
import { findLicenseFiles, findPackagePath, getLicenses } from "./licenses.js";
import type { Conversion, CycloneDxBom, CycloneDxComponent, Dependency, DependencyWithLicense } from "./types.js";

export const CONVERSIONS: Conversion[] = [
    {
        sbomPath: ".sbom/dependencies.json",
        outputPath: ".sbom/dependencies-list.json",
        enrichedOutputPath: ".sbom/dependencies-with-licenses.json",
    },
    {
        sbomPath: ".sbom/dependencies-prod.json",
        outputPath: ".sbom/dependencies-list-prod.json",
        enrichedOutputPath: ".sbom/dependencies-with-licenses-prod.json",
    },
];

function dependencyKey(dependency: Dependency): string {
    return `${dependency.name}@${dependency.version}`;
}

function dedupeAndSort<T extends Dependency>(dependencies: T[]): T[] {
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

export function convertSbomToDependencyList(conversion: Conversion): void {
    if (!fs.existsSync(conversion.sbomPath)) {
        return;
    }

    const sbom = JSON.parse(fs.readFileSync(conversion.sbomPath, "utf-8")) as CycloneDxBom;
    const components = (sbom.components ?? []).filter((component) => component.name && component.version);

    const dependencies = dedupeAndSort(
        components.map((component) => ({ name: getFullPackageName(component), version: component.version }))
    );
    const enrichedDependencies = dedupeAndSort(components.map(enrichComponent));

    fs.mkdirSync(path.dirname(conversion.outputPath), { recursive: true });
    fs.writeFileSync(conversion.outputPath, JSON.stringify(dependencies, null, 2));
    fs.writeFileSync(conversion.enrichedOutputPath, JSON.stringify(enrichedDependencies, null, 2));
}
