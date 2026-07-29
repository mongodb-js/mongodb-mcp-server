/**
 * Detects whether we're running on Node.js as opposed to a browser/web
 * environment. We rely on `process.versions.node` rather than `typeof process`
 * because bundlers (e.g. Vite) may replace `process` with a literal object
 * shim in the browser build, which would still be `"object"` at runtime.
 */
export function isNodeRuntime(): boolean {
    return typeof process !== "undefined" && process.versions !== undefined && process.versions.node !== undefined;
}
