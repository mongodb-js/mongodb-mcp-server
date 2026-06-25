#!/usr/bin/env node

/**
 * Main entry point for the MongoDB Remote MCP proxy.
 */
async function main(): Promise<void> {
    // TODO: Not yet implemented.
}

main().catch((error) => {
    process.stderr.write(`Fatal error: ${String(error)}\n`);
    process.exit(1);
});
