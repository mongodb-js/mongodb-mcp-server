/**
 * Bundles the eval entrypoint for use with `braintrust push`.
 *
 * # Why we run our own bundle step:
 * - Braintrust uses esbuild to bundle the eval script, but does not allow us to alias modules.
 * - Our eval script imports mdb-mcp-server, which (through its dependencies) references
 *   several optional native and desktop dependencies (e.g. electron, cpu-features,
 *   @mongodb-js/atlas-local, ssh2, os-dns-native). These dependencies contain `.node`
 *   native addons that esbuild cannot bundle, causing push/eval in Braintrust to fail if
 *   any are present—even if our actual code doesn't use them.
 *
 * # Our solution:
 * - We use esbuild ourselves to bundle the eval, explicitly aliasing all unused and optional
 *   dependencies to stub files. This ensures esbuild never attempts to bundle native code.
 * - The bundled output is a single CommonJS file at `tests/eval/dist/mongodb.eval.cjs`.
 * - For local runs, the eval script still imports mdb-mcp-server normally, so no behavior
 *   changes for local workflows.
 * - For `braintrust push`, our self-bundled version is uploaded—free of native code
 *   references—so Braintrust's own bundling phase will succeed.
 *
 * # Output format:
 * - CommonJS (`.cjs`), not ESM—Braintrust's server expects CJS. Using ESM and `import.meta.url`
 *   causes its internal bundler to fail.
 *
 * # External packages:
 * - `braintrust` (and related packages like `autoevals`, `fsevents`, `chokidar`) are marked
 *   as external—these are expected to be provided by the Braintrust CLI/Lambda runtime.
 *   Keeping these external ensures only one instance is loaded, and that `Eval()` properly
 *   registers with the runner via `globalThis`.
 */
import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const evalDir = join(scriptDir, "..");
const stub = join(scriptDir, "bundleEval/stub.mjs");
const osDnsStub = join(scriptDir, "bundleEval/osDnsNativeStub.cjs");
const outFile = join(evalDir, "dist/mongodb.eval.cjs");

mkdirSync(dirname(outFile), { recursive: true });

await esbuild.build({
    entryPoints: [join(evalDir, "mongodb.eval.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    // Optional deps the eval never uses (connection-string only: no Atlas Local,
    // SSH, OIDC/Electron). Stub them so esbuild can bundle without native binaries.
    alias: {
        electron: stub,
        "cpu-features": stub,
        ssh2: stub,
        bindings: stub,
        "macos-export-certificate-and-key": stub,
        "@mongodb-js/atlas-local": stub,
        "@mongodb-js/atlas-local-darwin-arm64": stub,
        "@mongodb-js/atlas-local-darwin-x64": stub,
        "@mongodb-js/atlas-local-linux-arm64-gnu": stub,
        "@mongodb-js/atlas-local-linux-x64-gnu": stub,
        "@mongodb-js/atlas-local-win32-x64-msvc": stub,
        "os-dns-native": osDnsStub,
    },
    // Provided by the Braintrust CLI / Lambda runtime; keep a single instance so
    // `Eval()` registration (via globalThis) is visible to the runner.
    external: ["braintrust", "autoevals", "fsevents", "chokidar"],
    logLevel: "info",
});

console.log(`Wrote ${outFile}`);
