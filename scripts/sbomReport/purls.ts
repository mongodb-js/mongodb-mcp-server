import fs from "fs";
import path from "path";
import type { CycloneDxBom, CycloneDxComponent } from "./types.js";

const SBOM_PATH = ".sbom/sbom-prod.cyclonedx.json";
const PURLS_PATH = ".sbom/purls.txt";

function npmPurl(name: string, version: string): string {
    if (name.startsWith("@")) {
        const slashIndex = name.indexOf("/");
        const namespace = name.slice(0, slashIndex);
        const packageName = name.slice(slashIndex + 1);
        return `pkg:npm/${encodeURIComponent(namespace)}/${packageName}@${version}`;
    }
    return `pkg:npm/${name}@${version}`;
}

function componentPurl(component: CycloneDxComponent): string {
    return component.purl ?? npmPurl(component.name, component.version);
}

/**
 * Writes the list of Package URLs (https://github.com/package-url/purl-spec) for
 * every component in the prod CycloneDX SBOM to `.sbom/purls.txt`. Only production
 * (shipped) dependencies are included, mirroring mongosh's Kondukto flow which
 * builds its SBOM from the bundled release dependencies. SilkBomb's `update`
 * command builds its SBOM from this PURLs file, which is then augmented and
 * uploaded to Kondukto (Invicti ASPM).
 */
export function generatePurls(): void {
    const sbom = JSON.parse(fs.readFileSync(SBOM_PATH, "utf-8")) as CycloneDxBom;
    const components = (sbom.components ?? []).filter((component) => component.name && component.version);

    const purls = Array.from(new Set(components.map(componentPurl))).sort();

    fs.mkdirSync(path.dirname(PURLS_PATH), { recursive: true });
    fs.writeFileSync(PURLS_PATH, `${purls.join("\n")}\n`);
}
