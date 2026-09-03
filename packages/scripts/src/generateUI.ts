/**
 * This script generates UI modules for tools by running the Vite build once
 * per UI module (vite-plugin-singlefile / rolldown cannot build multiple
 * single-file inputs in one pass).
 * It produces:
 * - src/lib/tools/*.ts - One module per mcp-ui component containing bundled HTML
 * - src/lib/apps/*.ts - One module per MCP App (ext-apps) widget containing bundled HTML
 * - src/lib/loaders.ts - Lazy loaders for each mcp-ui module
 * - src/lib/appLoaders.ts - Lazy loaders for each MCP App module
 */

import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readdirSync, rmSync, statSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..", "..", "ui");

/**
 * Discovers UI module entry keys. This mirrors the discovery in
 * packages/ui/vite.ui.config.ts — duplicated here so this project does not
 * import across package boundaries (composite project rootDir rules). The
 * entry key convention must match the vite config: `<Name>` for
 * src/components, `app-<Name>` for src/apps.
 */
function discoverUiEntries(): string[] {
    return (["components", "apps"] as const).flatMap((setDir) => {
        const dir = join(rootDir, "src", setDir);
        if (!existsSync(dir)) {
            return [];
        }
        return readdirSync(dir)
            .filter((entry) => statSync(join(dir, entry)).isDirectory() && existsSync(join(dir, entry, "index.ts")))
            .map((name) => (setDir === "apps" ? `app-${name}` : name));
    });
}

export function generateUI(): void {
    const entries = discoverUiEntries();
    console.log(`Building UI modules (${entries.join(", ")})...`);

    // Per-entry builds accumulate in dist/ui; clean once up front.
    rmSync(join(rootDir, "dist", "ui"), { recursive: true, force: true });

    entries.forEach((entryKey, index) => {
        execSync("vite build --config vite.ui.config.ts", {
            cwd: rootDir,
            stdio: "inherit",
            env: {
                ...process.env,
                MCP_UI_ENTRY: entryKey,
                // Only the last build regenerates the TS modules from the
                // accumulated HTML output.
                MCP_UI_FINALIZE: index === entries.length - 1 ? "1" : "0",
            },
        });
    });

    // The HTML is now embedded in the generated .ts modules.
    rmSync(join(rootDir, "dist", "ui"), { recursive: true, force: true });
    console.log("✓ UI modules generated");
}

// Run directly when executed as a script
if (import.meta.url === `file://${process.argv[1]}`) {
    generateUI();
}
