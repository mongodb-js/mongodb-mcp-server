/**
 * This script generates UI modules for tools by running the Vite build.
 * It produces:
 * - src/ui/lib/tools/*.ts - One module per UI component containing bundled HTML
 * - src/ui/lib/loaders.ts - Lazy loaders for each UI module
 */

import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..", "..");

export function generateUI(): void {
    console.log("Building UI modules...");
    execSync("vite build --config vite.ui.config.ts", {
        cwd: rootDir,
        stdio: "inherit",
    });
    console.log("✓ UI modules generated");
}

// Run directly when executed as a script
if (import.meta.url === `file://${process.argv[1]}`) {
    generateUI();
}
