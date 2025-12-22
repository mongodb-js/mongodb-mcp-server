import { build, type Plugin, type PluginOption, type InlineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

export interface BuildCustomUIOptions {
    /** Directory containing React component folders */
    componentsDir: string;
    /** Output directory for generated files */
    outputDir: string;
}

// Converts PascalCase to kebab-case: "ListDatabases" -> "list-databases"
function toKebabCase(pascalCase: string): string {
    return pascalCase
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
        .toLowerCase();
}

// Discovers component directories and builds tool name mappings
function discoverComponents(componentsDir: string): { components: string[]; toolToComponentMap: Record<string, string> } {
    const components: string[] = [];
    const toolToComponentMap: Record<string, string> = {};

    if (!existsSync(componentsDir)) {
        throw new Error(`Components directory does not exist: ${componentsDir}`);
    }

    for (const entry of readdirSync(componentsDir)) {
        const entryPath = join(componentsDir, entry);

        if (!statSync(entryPath).isDirectory()) {
            continue;
        }

        // Check for index.ts or index.tsx
        const hasIndexTs = existsSync(join(entryPath, "index.ts"));
        const hasIndexTsx = existsSync(join(entryPath, "index.tsx"));

        if (hasIndexTs || hasIndexTsx) {
            components.push(entry);
            toolToComponentMap[toKebabCase(entry)] = entry;
        }
    }

    if (components.length === 0) {
        throw new Error(
            `No components found in ${componentsDir}. ` +
                `Each component should be in its own folder with an index.ts or index.tsx file.`
        );
    }

    return { components, toolToComponentMap };
}

// Get the path to the build assets (template.html and mount.tsx)
function getBuildAssetsPath(): string {
    const currentDir = dirname(fileURLToPath(import.meta.url));

    // When running from dist/esm/ui/build/, assets are at dist/ui-build-assets/
    const distAssetsPath = resolve(currentDir, "../../../ui-build-assets");
    if (existsSync(distAssetsPath)) {
        return distAssetsPath;
    }

    // When running from src/ui/build/ during development, use the local files
    const srcAssetsPath = currentDir;
    if (existsSync(join(srcAssetsPath, "template.html"))) {
        return srcAssetsPath;
    }

    throw new Error(
        "Could not find build assets (template.html, mount.tsx). " +
            "This may indicate a corrupted installation of mongodb-mcp-server."
    );
}

/**
 * Vite plugin that generates HTML entry files for each discovered component
 * based on the template.html file.
 */
function generateHtmlEntries(
    components: string[],
    entriesDir: string,
    templatePath: string,
    mountPath: string
): Plugin {
    return {
        name: "generate-html-entries",
        buildStart() {
            const template = readFileSync(templatePath, "utf-8");

            if (!existsSync(entriesDir)) {
                mkdirSync(entriesDir, { recursive: true });
            }

            for (const componentName of components) {
                const html = template
                    .replace("{{COMPONENT_NAME}}", componentName)
                    .replace("{{TITLE}}", componentName.replace(/([A-Z])/g, " $1").trim())
                    .replace("{{MOUNT_PATH}}", mountPath);

                const outputPath = join(entriesDir, `${componentName}.html`);
                writeFileSync(outputPath, html);
                console.log(`[build-custom-ui] Generated entry: ${componentName}.html`);
            }
        },
    };
}

/**
 * Vite plugin that generates per-tool UI modules after the build completes.
 * Generates .js files with .d.ts type declarations.
 */
function generateUIModules(
    toolToComponentMap: Record<string, string>,
    htmlOutputDir: string,
    modulesOutputDir: string
): Plugin {
    return {
        name: "generate-ui-modules",
        closeBundle() {
            if (!existsSync(htmlOutputDir)) {
                console.warn("[build-custom-ui] HTML output directory not found, skipping module generation");
                return;
            }

            const toolsDir = join(modulesOutputDir, "tools");
            if (!existsSync(toolsDir)) {
                mkdirSync(toolsDir, { recursive: true });
            }

            const generatedTools: string[] = [];

            for (const [toolName, componentName] of Object.entries(toolToComponentMap)) {
                const htmlFile = join(htmlOutputDir, `${componentName}.html`);
                if (!existsSync(htmlFile)) {
                    console.warn(`[build-custom-ui] HTML file not found for component "${componentName}" (tool: "${toolName}")`);
                    continue;
                }
                const html = readFileSync(htmlFile, "utf-8");
                const exportName = `${componentName}Html`;

                // Generate .js file
                const jsContent = `/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated by: mongodb-mcp-server-build-ui
 * Tool: ${toolName}
 * Component: ${componentName}
 */
export const ${exportName} = ${JSON.stringify(html)};
`;
                writeFileSync(join(toolsDir, `${toolName}.js`), jsContent);

                // Generate .d.ts file
                const dtsContent = `/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated by: mongodb-mcp-server-build-ui
 * Tool: ${toolName}
 * Component: ${componentName}
 */
export declare const ${exportName}: string;
`;
                writeFileSync(join(toolsDir, `${toolName}.d.ts`), dtsContent);

                generatedTools.push(toolName);
            }

            console.log(`[build-custom-ui] Generated ${generatedTools.length} UI module(s): ${generatedTools.join(", ")}`);
        },
    };
}

/**
 * Custom mount script generator that creates a mount.tsx for the consumer's components.
 * This is needed because the original mount.tsx uses relative paths to discover components.
 */
function generateCustomMount(componentsDir: string, entriesDir: string): string {
    const mountContent = `/// <reference types="vite/client" />
import React from "react";
import { createRoot } from "react-dom/client";

// Type for component modules loaded via glob import
type ComponentModule = Record<string, React.ComponentType>;

// Auto-import all components using Vite's glob import
const componentModules: Record<string, ComponentModule> = import.meta.glob("${componentsDir}/*/index.{ts,tsx}", {
    eager: true,
});

// Build component registry from glob imports
const components: Record<string, React.ComponentType> = {};

for (const [path, module] of Object.entries(componentModules)) {
    const match = path.match(/\\/([^/]+)\\/index\\.(ts|tsx)$/);
    if (match) {
        const componentName = match[1];
        if (!componentName) continue;
        const Component = module[componentName];
        if (Component) {
            components[componentName] = Component;
        } else {
            console.warn(
                \`[mount] Component "\${componentName}" not found in \${path}. \` +
                    \`Make sure to export it as: export { \${componentName} } from "./\${componentName}.js"\`
            );
        }
    }
}

function mount(): void {
    const container = document.getElementById("root");
    if (!container) {
        console.error("[mount] No #root element found");
        return;
    }

    const componentName = container.dataset.component;
    if (!componentName) {
        console.error("[mount] No data-component attribute found on #root");
        return;
    }

    const Component = components[componentName];
    if (!Component) {
        console.error(\`[mount] Unknown component: \${componentName}\`);
        console.error(\`[mount] Available components: \${Object.keys(components).join(", ")}\`);
        return;
    }

    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <Component />
        </React.StrictMode>
    );
}

mount();
`;

    const mountPath = join(entriesDir, "mount.tsx");
    writeFileSync(mountPath, mountContent);
    return mountPath;
}

/**
 * Builds custom UI components into HTML strings.
 *
 * @param options - Build options
 * @param options.componentsDir - Directory containing React component folders
 * @param options.outputDir - Output directory for generated files
 */
export async function buildCustomUI(options: BuildCustomUIOptions): Promise<void> {
    const { componentsDir: componentsDirRelative, outputDir: outputDirRelative } = options;

    // Resolve paths relative to current working directory
    const componentsDir = resolve(process.cwd(), componentsDirRelative);
    const outputDir = resolve(process.cwd(), outputDirRelative);

    console.log(`[build-custom-ui] Components directory: ${componentsDir}`);
    console.log(`[build-custom-ui] Output directory: ${outputDir}`);

    // Discover components
    const { components, toolToComponentMap } = discoverComponents(componentsDir);
    console.log(`[build-custom-ui] Found ${components.length} component(s): ${components.join(", ")}`);

    // Get build assets path
    const assetsPath = getBuildAssetsPath();
    const templatePath = join(assetsPath, "template.html");

    // Create temporary entries directory
    const entriesDir = join(outputDir, ".cache", "entries");
    if (!existsSync(entriesDir)) {
        mkdirSync(entriesDir, { recursive: true });
    }

    // Generate custom mount script for consumer's components
    const mountPath = generateCustomMount(componentsDir, entriesDir);

    // HTML output directory (intermediate)
    const htmlOutputDir = join(outputDir, ".cache", "html");

    // Build configuration
    const config: InlineConfig = {
        root: entriesDir,
        configFile: false,
        plugins: [
            generateHtmlEntries(components, entriesDir, templatePath, mountPath),
            nodePolyfills({
                include: ["buffer", "stream"],
                globals: {
                    Buffer: true,
                },
            }) as unknown as PluginOption,
            react(),
            viteSingleFile({
                removeViteModuleLoader: true,
            }),
            generateUIModules(toolToComponentMap, htmlOutputDir, outputDir),
        ],
        build: {
            outDir: htmlOutputDir,
            emptyOutDir: true,
            rollupOptions: {
                input: Object.fromEntries(components.map((name) => [name, resolve(entriesDir, `${name}.html`)])),
                output: {
                    inlineDynamicImports: false,
                },
            },
            assetsInlineLimit: 100000000,
            sourcemap: false,
            minify: "esbuild",
        },
        resolve: {
            alias: {
                // Allow importing from mongodb-mcp-server/ui
                "mongodb-mcp-server/ui": resolve(dirname(fileURLToPath(import.meta.url)), "../index.js"),
            },
        },
        logLevel: "info",
    };

    // Run the build
    await build(config);
}

