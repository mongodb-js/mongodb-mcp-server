import { defineConfig, type Plugin, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

// import.meta-based so this module can also be imported by plain node/tsx
// (the generate:ui script reuses discoverUiEntries); vite's config loader
// would otherwise be the only place `__dirname` is defined.
const configDir = dirname(fileURLToPath(import.meta.url));

const componentsDir = resolve(configDir, "src/components");
const appsDir = resolve(configDir, "src/apps");
// Use node_modules/.cache for generated HTML entries - these are build artifacts, not source files
const entriesDir = resolve(configDir, "node_modules/.cache/mcp-ui/ui-entries");
const templatePath = resolve(configDir, "src/build/template.html");
const mountPath = resolve(configDir, "src/build/mount.tsx");
const generatedDir = resolve(configDir, "src/lib");
const uiDistPath = resolve(configDir, "dist/ui");

function toKebabCase(pascalCase: string): string {
    return pascalCase
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
        .toLowerCase();
}

interface DiscoveredModules {
    /** Folder names, e.g. ["ListDatabases"] */
    names: string[];
    /** tool name (kebab-case folder name) -> folder name */
    toolToModuleMap: Record<string, string>;
}

// Discovers UI module directories (each with an index.ts) and builds tool name mappings
function discoverModules(dir: string): DiscoveredModules {
    const names: string[] = [];
    const toolToModuleMap: Record<string, string> = {};

    if (!existsSync(dir)) {
        return { names, toolToModuleMap };
    }

    for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        const indexPath = join(entryPath, "index.ts");

        if (statSync(entryPath).isDirectory() && existsSync(indexPath)) {
            names.push(entry);
            toolToModuleMap[toKebabCase(entry)] = entry;
        }
    }

    return { names, toolToModuleMap };
}

interface UiSet {
    /** Directory under src/ that holds the module folders */
    srcDir: string;
    discovered: DiscoveredModules;
    /** Built HTML entry file name for a module folder */
    entryFileName: (moduleName: string) => string;
    /** Generated TS module export name for a module folder, e.g. ListDatabasesHtml / ExplainAppHtml */
    exportName: (moduleName: string) => string;
    /** Subdirectory of src/lib/ that receives the generated per-tool modules */
    generatedSubdir: string;
    /** File in src/lib/ that receives the generated lazy loader map */
    loadersFile: string;
    /** Exported name of the generated loader map */
    loadersConst: string;
}

// components/ are mcp-ui dialect widgets (embedded into tool results);
// apps/ are MCP Apps (ext-apps) widgets (served as ui:// resources).
// App HTML entries are prefixed so a folder name can never collide with a
// component folder of the same name in rollup inputs or dist output.
const uiSets: UiSet[] = [
    {
        srcDir: "components",
        discovered: discoverModules(componentsDir),
        entryFileName: (name) => `${name}.html`,
        exportName: (name) => `${name}Html`,
        generatedSubdir: "tools",
        loadersFile: "loaders.ts",
        loadersConst: "uiLoaders",
    },
    {
        srcDir: "apps",
        discovered: discoverModules(appsDir),
        entryFileName: (name) => `app-${name}.html`,
        exportName: (name) => `${name}AppHtml`,
        generatedSubdir: "apps",
        loadersFile: "appLoaders.ts",
        loadersConst: "appLoaders",
    },
];

/**
 * All discovered UI entries across every set. The generate:ui script builds
 * one single-file bundle per module (vite-plugin-singlefile / rolldown does
 * not support multiple inputs with code splitting disabled); it discovers
 * entries itself, keeping the same `<Name>` / `app-<Name>` key convention.
 */
function discoverUiEntries(): { entryKey: string; entryFileName: string }[] {
    return uiSets.flatMap((set) =>
        set.discovered.names.map((name) => {
            const fileName = set.entryFileName(name);
            return { entryKey: fileName.replace(/\.html$/, ""), entryFileName: fileName };
        })
    );
}

/**
 * Vite plugin that generates HTML entry files for each discovered UI module
 * based on the template.html file.
 */
function generateHtmlEntries(): Plugin {
    return {
        name: "generate-html-entries",
        buildStart(): void {
            const template = readFileSync(templatePath, "utf-8");

            if (!existsSync(entriesDir)) {
                mkdirSync(entriesDir, { recursive: true });
            }

            for (const set of uiSets) {
                for (const moduleName of set.discovered.names) {
                    const html = template
                        .replace("{{COMPONENT_NAME}}", moduleName)
                        .replace("{{TITLE}}", moduleName.replace(/([A-Z])/g, " $1").trim()) // "ListDatabases" -> "List Databases"
                        .replace("{{MOUNT_PATH}}", mountPath);

                    const outputPath = join(entriesDir, set.entryFileName(moduleName));
                    writeFileSync(outputPath, html);
                    console.log(`[generate-html-entries] Generated ${set.entryFileName(moduleName)}`);
                }
            }
        },
    };
}

/**
 * Vite plugin that generates per-tool UI modules after the build completes.
 */
function generateUIModule(): Plugin {
    return {
        name: "generate-ui-module",
        closeBundle(): void {
            // With per-entry builds (MCP_UI_ENTRY), only the final invocation
            // regenerates the TS modules from the accumulated HTML output.
            if (process.env.MCP_UI_FINALIZE !== "1") {
                return;
            }
            if (!existsSync(uiDistPath)) {
                console.warn("[generate-ui-module] dist/ui not found, skipping module generation");
                return;
            }

            for (const set of uiSets) {
                const modulesDir = join(generatedDir, set.generatedSubdir);
                mkdirSync(modulesDir, { recursive: true });
                const existingModuleFiles = readdirSync(modulesDir).filter((file) => file.endsWith(".ts"));

                const generatedTools: string[] = [];

                for (const [toolName, moduleName] of Object.entries(set.discovered.toolToModuleMap)) {
                    const htmlFile = join(uiDistPath, set.entryFileName(moduleName));
                    if (!existsSync(htmlFile)) {
                        console.warn(
                            `[generate-ui-module] HTML file not found for module "${moduleName}" (tool: "${toolName}")`
                        );
                        continue;
                    }
                    const html = readFileSync(htmlFile, "utf-8");
                    const exportName = set.exportName(moduleName);

                    const toolModuleContent = `/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated by: vite build --config vite.ui.config.ts
 * Tool: ${toolName}
 * Component: ${moduleName}
 */
export const ${exportName} = ${JSON.stringify(html)};
`;
                    writeFileSync(join(modulesDir, `${toolName}.ts`), toolModuleContent);
                    generatedTools.push(toolName);
                }

                // Generate the loaders file with lazy import functions for each tool
                // Uses .js extension for ESM compatibility (tsc compiles .ts -> .js)
                const loaderEntries = generatedTools
                    .map((toolName) => {
                        const moduleName = set.discovered.toolToModuleMap[toolName];
                        if (!moduleName) {
                            throw new Error(`No module discovered for tool "${toolName}"`);
                        }
                        return `    "${toolName}": async () => {
        const mod = await import("./${set.generatedSubdir}/${toolName}.js");
        return mod.${set.exportName(moduleName)};
    }`;
                    })
                    .join(",\n");

                const loadersContent = `/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated by: pnpm generate:ui
 *
 * Lazy loaders for UI modules. Each loader returns a Promise<string> with the HTML.
 */
export const ${set.loadersConst}: Record<string, () => Promise<string>> = {
${loaderEntries}
};
`;
                writeFileSync(join(generatedDir, set.loadersFile), loadersContent);

                console.log(
                    `[generate-ui-module] Generated ${generatedTools.length} lazy UI module(s) from ${set.srcDir}: ${generatedTools.join(", ")}`
                );
                console.log(
                    `[generate-ui-module] Generated ${set.loadersFile} with ${generatedTools.length} loader(s)`
                );

                // Remove stale tool modules from previous builds (e.g., when a UI module was deleted)
                const staleModules = existingModuleFiles.filter((file) => {
                    const toolName = file.replace(/\.ts$/, "");
                    return !generatedTools.includes(toolName);
                });
                for (const staleModule of staleModules) {
                    rmSync(join(modulesDir, staleModule));
                    console.log(`[generate-ui-module] Removed stale module: ${staleModule}`);
                }
            }
        },
    };
}

// vite-plugin-singlefile forces `output.codeSplitting: false`, which rolldown
// rejects for multiple inputs — so each UI module is built in its own vite
// invocation, selected by MCP_UI_ENTRY (the entry key). The generate:ui script
// iterates over discoverUiEntries(); a direct `vite build` only works when a
// single UI module exists.
// Computed lazily inside defineConfig so importing this module (e.g. from the
// generate:ui script, for discoverUiEntries) never throws.
function resolveBuildInput(): Record<string, string> {
    const selectedEntry = process.env.MCP_UI_ENTRY;
    const allEntries = discoverUiEntries();

    if (selectedEntry) {
        const entry = allEntries.find((e) => e.entryKey === selectedEntry);
        if (!entry) {
            throw new Error(
                `Unknown MCP_UI_ENTRY "${selectedEntry}". Available entries: ${allEntries.map((e) => e.entryKey).join(", ")}`
            );
        }
        return { [entry.entryKey]: resolve(entriesDir, entry.entryFileName) };
    }

    if (allEntries.length > 1) {
        throw new Error(
            `Multiple UI modules found (${allEntries.map((e) => e.entryKey).join(", ")}). ` +
                `Run via \`pnpm generate:ui\` (builds each module separately) or set MCP_UI_ENTRY=<name>.`
        );
    }
    return Object.fromEntries(allEntries.map((e) => [e.entryKey, resolve(entriesDir, e.entryFileName)]));
}

export default defineConfig(
    (): UserConfig => ({
        root: entriesDir,
        plugins: [
            generateHtmlEntries(),
            nodePolyfills({
                include: ["buffer", "stream"],
                globals: {
                    Buffer: true,
                },
            }),
            react(),
            viteSingleFile({
                removeViteModuleLoader: true,
            }),
            generateUIModule(),
        ],
        build: {
            outDir: resolve(configDir, "dist/ui"),
            // The generate:ui script owns cleaning; per-entry builds accumulate.
            emptyOutDir: false,
            rollupOptions: {
                input: resolveBuildInput(),
            },
            assetsInlineLimit: 100000000,
            sourcemap: false,
            minify: "esbuild",
        },
        resolve: {
            alias: {
                "@ui": resolve(configDir, "src"),
            },
        },
    })
);
