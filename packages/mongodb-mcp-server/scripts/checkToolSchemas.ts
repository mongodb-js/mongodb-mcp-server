#!/usr/bin/env tsx

import { spawnSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Fails when MCP Inspector's schema portability lint reports anything for the tools this server lists, so that
 * schemas some MCP clients reject (such as the empty schema `{}`) are caught before they ship.
 *
 * Inspector's `--strict` only exits non-zero for error-severity findings, so this reads the findings from its JSON
 * output and fails on warnings too. Requires a build (`pnpm run build`).
 */

const INSPECTOR = "@modelcontextprotocol/inspector@2.12.0";

const __filename = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(__filename), "..");

interface ToolSchemaFindings {
    toolName: string;
    findings: { rule: string; severity: string; schema: string; path: string; issue: string }[];
}

interface InspectorOutput {
    result: { tools: { name: string }[] };
    schemaFindings?: ToolSchemaFindings[];
}

const { status, stdout, stderr, error } = spawnSync(
    "pnpm",
    [
        "dlx",
        INSPECTOR,
        "--cli",
        "--method",
        "tools/list",
        "--strict",
        "--format",
        "json",
        // No Atlas API credentials are configured, so the Atlas tools are not listed and not checked yet.
        "node",
        resolve(packageRoot, "dist", "index.js"),
    ],
    { cwd: packageRoot, encoding: "utf8" }
);

if (error) {
    throw error;
}

let output: InspectorOutput;
try {
    output = JSON.parse(stdout) as InspectorOutput;
} catch {
    console.error(stderr);
    throw new Error(`MCP Inspector did not return JSON (exit code ${status}).`);
}

const results = output.schemaFindings ?? [];
const count = results.reduce((total, { findings }) => total + findings.length, 0);

if (count === 0) {
    console.log(`Tool schemas are portable: no findings across ${output.result.tools.length} tools.`);
    process.exit(0);
}

for (const { toolName, findings } of results) {
    for (const { rule, severity, schema, path, issue } of findings) {
        console.error(`${severity} [${rule}] ${toolName}: ${schema}.${path}\n    ${issue}`);
    }
}
console.error(`\nMCP Inspector reported ${count} schema finding(s) across ${results.length} tool(s).`);
process.exit(1);
