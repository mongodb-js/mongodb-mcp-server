#!/usr/bin/env tsx

/**
 * Main script that generates all documentation and configuration files:
 * - CLI arguments and configuration tables
 * - Tool documentation
 * - UI modules
 */

import { copyFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { generateArguments } from "./generateArguments.js";
import { generateToolDocumentation } from "./generateToolDocumentation.js";
import { generateUI } from "./generateUI.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..", "..", "..");

/**
 * Copies the root README.md into the mongodb-mcp-server package directory so
 * the published npm package ships a README that stays in sync with the repo.
 */
function copyReadmeToPackage(): void {
    const rootReadme = join(repoRoot, "README.md");
    const packageReadme = join(repoRoot, "packages", "mongodb-mcp-server", "README.md");

    if (!existsSync(rootReadme)) {
        console.warn(`⚠️  Root README.md not found at ${rootReadme}`);
        return;
    }

    copyFileSync(rootReadme, packageReadme);
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
