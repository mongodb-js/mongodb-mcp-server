#!/usr/bin/env tsx

/**
 * Main script that generates all documentation and configuration files:
 * - CLI arguments and configuration tables
 * - Tool documentation
 * - UI modules
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { generateArguments } from "./generateArguments.js";
import { generateToolDocumentation } from "./generateToolDocumentation.js";
import { generateUI } from "./generateUI.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..", "..", "..");
const GITHUB_BLOB_URL = "https://github.com/mongodb-js/mongodb-mcp-server/blob/main";

/**
 * Rewrites repository-root-relative link targets (e.g.
 * `deploy/azure/README.md`, `MCP_SERVER_LIBRARY.md`, `CONTRIBUTING.md`, or a
 * `packages/...` path) to absolute GitHub URLs. The package README is not
 * shipped at the repo root, so root-relative links would otherwise resolve
 * beneath the package and 404.
 */
function rewriteRelativeReadmeLinks(content: string): string {
    return content.replace(/\]\((\S+?)\)/g, (match: string, target: string) => {
        // Keep same-file anchors and absolute/scheme URLs as-is.
        if (target.startsWith("#")) {
            return match;
        }
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) {
            return match;
        }
        return `](${GITHUB_BLOB_URL}/${target})`;
    });
}

/**
 * Copies the root README.md into the mongodb-mcp-server package directory so
 * the published npm package ships a README that stays in sync with the repo,
 * rewriting repo-root-relative links to absolute GitHub URLs.
 */
function copyReadmeToPackage(): void {
    const rootReadme = join(repoRoot, "README.md");
    const packageReadme = join(repoRoot, "packages", "mongodb-mcp-server", "README.md");

    if (!existsSync(rootReadme)) {
        console.warn(`⚠️  Root README.md not found at ${rootReadme}`);
        return;
    }

    const content = rewriteRelativeReadmeLinks(readFileSync(rootReadme, "utf-8"));
    writeFileSync(packageReadme, content, "utf-8");
    console.log("✓ Copied README.md to packages/mongodb-mcp-server");
}

console.log("Generating arguments and configuration...");
generateArguments();

console.log("\nGenerating tool documentation...");
generateToolDocumentation();

console.log("\nGenerating UI modules...");
generateUI();

console.log("\nSyncing README to the mongodb-mcp-server package...");
copyReadmeToPackage();

console.log("\n✅ All documentation generated successfully!");
