import { defineConfig, Plugin, PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";

const componentsDir = resolve(__dirname, "src/ui/components");
// Use node_modules/.cache for generated HTML entries - these are build artifacts, not source files
const entriesDir = resolve(__dirname, "node_modules/.cache/mongodb-mcp-server/ui-entries");
const templatePath = resolve(__dirname, "src/ui/build/template.html");
const mountPath = resolve(__dirname, "src/ui/build/mount.tsx");

/**
 * Discover all component directories in src/ui/components/
 * Each directory should have an index.ts that exports the component
 */
function discoverComponents(): string[] {
    const components: string[] = [];

    try {
        const dirs = readdirSync(componentsDir);
        for (const dir of dirs) {
            const dirPath = join(componentsDir, dir);
            if (statSync(dirPath).isDirectory()) {
                // Check if index.ts exists
                const indexPath = join(dirPath, "index.ts");
                if (existsSync(indexPath)) {
                    components.push(dir);
                }
            }
        }
    } catch {
        console.warn("No components directory found or error reading it");
    }

    return components;
}

/**
 * Vite plugin that generates HTML entry files for each component
 * based on the template.html file
 */
function generateHtmlEntries(): Plugin {
    return {
        name: "generate-html-entries",
        buildStart() {
            const components = discoverComponents();
            const template = readFileSync(templatePath, "utf-8");

            if (!existsSync(entriesDir)) {
                mkdirSync(entriesDir, { recursive: true });
            }

            for (const componentName of components) {
                const html = template
                    .replace("{{COMPONENT_NAME}}", componentName)
                    .replace("{{TITLE}}", componentName.replace(/([A-Z])/g, " $1").trim()) // "ListDatabases" -> "List Databases"
                    .replace("{{MOUNT_PATH}}", mountPath);

                const outputPath = join(entriesDir, `${componentName}.html`);
                writeFileSync(outputPath, html);
                console.log(`[generate-html-entries] Generated ${componentName}.html`);
            }
        },
    };
}

const components = discoverComponents();

export default defineConfig({
    root: entriesDir,
    plugins: [
        generateHtmlEntries(),
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
    ],
    build: {
        outDir: resolve(__dirname, "dist/ui"),
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
            "@ui": resolve(__dirname, "src/ui"),
        },
    },
});
