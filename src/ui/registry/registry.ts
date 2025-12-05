import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { uiMap } from "./uiMap.js";

/**
 * Get the directory of the current module, works in both ESM and CJS.
 */
function getCurrentDir(): string {
    if (typeof __dirname !== "undefined") {
        return __dirname;
    }
    return dirname(fileURLToPath(import.meta.url));
}

/**
 * Find the package root by looking for package.json walking up from the current directory.
 */
function findPackageRoot(startDir: string): string {
    let dir = startDir;
    while (dir !== dirname(dir)) {
        if (existsSync(join(dir, "package.json"))) {
            return dir;
        }
        dir = dirname(dir);
    }
    return process.cwd();
}

/**
 * Get the default UI dist path by finding the package root.
 */
function getDefaultUIDistPath(): string {
    const currentDir = getCurrentDir();
    const packageRoot = findPackageRoot(currentDir);
    return join(packageRoot, "dist", "ui");
}

/**
 * UI Registry that manages bundled UI HTML strings for tools.
 */
export class UIRegistry {
    private customUIs: Map<string, string> = new Map();
    private cache: Map<string, string> = new Map();
    private uiDistPath: string;

    constructor(options?: { customUIs?: Record<string, string> }) {
        this.uiDistPath = getDefaultUIDistPath();

        if (options?.customUIs) {
            for (const [toolName, html] of Object.entries(options.customUIs)) {
                this.customUIs.set(toolName, html);
            }
        }
    }

    /**
     * Get the UI HTML string for a tool.
     * Returns the custom UI if provided, otherwise loads the default from disk.
     * @param toolName The name of the tool
     * @returns The HTML string, or undefined if no UI exists for this tool
     */
    get(toolName: string): string | undefined {
        if (this.customUIs.has(toolName)) {
            return this.customUIs.get(toolName);
        }

        const componentName = uiMap[toolName];
        if (!componentName) {
            return undefined;
        }

        if (this.cache.has(toolName)) {
            return this.cache.get(toolName);
        }

        const filePath = join(this.uiDistPath, `${componentName}.html`);
        if (!existsSync(filePath)) {
            return undefined;
        }

        try {
            const html = readFileSync(filePath, "utf-8");
            this.cache.set(toolName, html);
            return html;
        } catch {
            return undefined;
        }
    }
}
