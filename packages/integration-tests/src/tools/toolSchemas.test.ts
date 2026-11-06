import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../../../..");
const serverPath = path.resolve(projectRoot, "packages/mongodb-mcp-server/dist/esm/index.js");
// Run with `pnpm dlx` rather than installed as a dependency: the Inspector pulls in React 19, which would change how
// the lockfile resolves React for @mongodb-js/mcp-core's @mcp-ui/server dependency.
const INSPECTOR = "@modelcontextprotocol/inspector@2.12.0";

// Allows for downloading the Inspector on the first run.
const INSPECTOR_TIMEOUT_MS = 180_000;

interface InspectorOutput {
    result: { tools: { name: string }[] };
    schemaFindings?: {
        toolName: string;
        findings: { rule: string; severity: string; schema: string; path: string }[];
    }[];
}

/**
 * Lists the built server's tools with MCP Inspector and returns its schema portability findings, which flag schemas
 * that some MCP clients reject or mishandle (such as the empty schema `{}`). `--strict` alone only fails on
 * error-severity findings, so the findings are read from the JSON output and warnings count too.
 */
async function lintToolSchemas(): Promise<{ toolCount: number; findings: string[] }> {
    const { stdout } = await promisify(execFile)(
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
            process.execPath,
            serverPath,
            "--telemetry",
            "disabled",
        ],
        { cwd: projectRoot, maxBuffer: 64 * 1024 * 1024 }
    );
    const output = JSON.parse(stdout) as InspectorOutput;
    return {
        toolCount: output.result.tools.length,
        findings: (output.schemaFindings ?? []).flatMap(({ toolName, findings }) =>
            findings.map(({ rule, severity, schema, path }) => `${toolName}: ${schema}.${path} (${severity}: ${rule})`)
        ),
    };
}

describe("tool schemas", () => {
    it(
        "have no MCP Inspector portability findings",
        async () => {
            const { toolCount, findings } = await lintToolSchemas();
            expect(toolCount).toBeGreaterThan(0);

            // For "any value", use ANY_ADDITIONAL_PROPERTIES or ANY_ARRAY_ITEMS from @mongodb-js/mcp-core with `.meta()`.
            expect(findings).toEqual([]);
        },
        INSPECTOR_TIMEOUT_MS
    );
});
