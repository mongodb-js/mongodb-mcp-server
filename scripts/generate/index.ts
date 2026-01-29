#!/usr/bin/env tsx

/**
 * Main script that generates all documentation and configuration files:
 * - CLI arguments and configuration tables
 * - Tool documentation
 */

import { generateArguments } from "./generateArguments.js";
import { generateToolDocumentation } from "./generateToolDocumentation.js";

console.log("Generating arguments and configuration...");
generateArguments();

console.log("\nGenerating tool documentation...");
generateToolDocumentation();

console.log("\n✅ All documentation generated successfully!");
