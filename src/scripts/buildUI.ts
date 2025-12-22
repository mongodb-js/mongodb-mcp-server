#!/usr/bin/env node

/**
 * CLI tool for building custom UI components into HTML strings.
 *
 * Usage:
 *   npx mongodb-mcp-server-build-ui <componentsDir> --output <outputDir>
 *
 * Example:
 *   npx mongodb-mcp-server-build-ui ./src/custom-ui/components --output ./dist/custom-ui
 */

const REQUIRED_DEPENDENCIES = [
    "vite",
    "react",
    "react-dom",
    "@vitejs/plugin-react",
    "vite-plugin-singlefile",
    "vite-plugin-node-polyfills",
] as const;

async function checkDependencies(): Promise<void> {
    const missing: string[] = [];

    for (const dep of REQUIRED_DEPENDENCIES) {
        try {
            await import(dep);
        } catch {
            missing.push(dep);
        }
    }

    if (missing.length > 0) {
        console.error(`\nMissing required dependencies: ${missing.join(", ")}\n`);
        console.error("To build custom UIs, install them:");
        console.error(`  npm install --save-dev ${missing.join(" ")}\n`);
        process.exit(1);
    }
}

function printUsage(): void {
    console.log(`
Usage: mongodb-mcp-server-build-ui <componentsDir> [options]

Arguments:
  componentsDir    Directory containing React component folders

Options:
  --output, -o     Output directory for generated files (default: ./dist/custom-ui)
  --help, -h       Show this help message

Example:
  npx mongodb-mcp-server-build-ui ./src/custom-ui/components --output ./dist/custom-ui

Component Structure:
  Each component should be in its own folder with an index.ts that exports the component:
  
  components/
  └── ListUsers/
      ├── index.ts          # export { ListUsers } from "./ListUsers.js"
      └── ListUsers.tsx     # React component using useRenderData hook
`);
}

function parseArgs(args: string[]): { componentsDir: string; outputDir: string } | null {
    const positionalArgs: string[] = [];
    let outputDir = "./dist/custom-ui";

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "--help" || arg === "-h") {
            printUsage();
            process.exit(0);
        }

        if (arg === "--output" || arg === "-o") {
            const nextArg = args[i + 1];
            if (!nextArg || nextArg.startsWith("-")) {
                console.error("Error: --output requires a directory path\n");
                printUsage();
                return null;
            }
            outputDir = nextArg;
            i++; // Skip next arg
            continue;
        }

        if (arg?.startsWith("-")) {
            console.error(`Error: Unknown option: ${arg}\n`);
            printUsage();
            return null;
        }

        if (arg) {
            positionalArgs.push(arg);
        }
    }

    if (positionalArgs.length === 0) {
        console.error("Error: componentsDir is required\n");
        printUsage();
        return null;
    }

    if (positionalArgs.length > 1) {
        console.error("Error: Too many arguments\n");
        printUsage();
        return null;
    }

    return {
        componentsDir: positionalArgs[0]!,
        outputDir,
    };
}

async function main(): Promise<void> {
    // Check dependencies first
    await checkDependencies();

    // Parse command line arguments
    const args = parseArgs(process.argv.slice(2));
    if (!args) {
        process.exit(1);
    }

    const { componentsDir, outputDir } = args;

    // Import and run the build function
    const { buildCustomUI } = await import("../ui/build/buildCustomUI.js");

    try {
        await buildCustomUI({
            componentsDir,
            outputDir,
        });
        console.log(`\nCustom UIs built successfully to: ${outputDir}`);
    } catch (error) {
        console.error("\nFailed to build custom UIs:");
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main().catch((error: unknown) => {
    console.error("Fatal error:", error);
    process.exit(1);
});

