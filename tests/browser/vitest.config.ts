import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export default defineConfig({
    define: {
        process: JSON.stringify({ version: "v24.0.0" }),
        "process.env": JSON.stringify({}),
        "process.version": JSON.stringify("v24.0.0"),
        "process.argv": JSON.stringify([]),
        global: "globalThis",
    },
    test: {
        include: ["tests/**/*.test.ts"],
        browser: {
            enabled: true,
            instances: [
                {
                    browser: "chromium",
                },
            ],
            provider: "playwright",
            headless: true,
        },
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov"],
            reportsDirectory: "../../coverage/tests/browser",
        },
        testTimeout: 60000,
        setupFiles: [path.resolve(__dirname, "setup.ts")],
    },
    resolve: {
        alias: {
            "@mongodb-js/devtools-connect": localPolyfill("@mongodb-js/devtools-connect"),
            "@mongodb-js/devtools-proxy-support/proxy-options": emptyPolyfill(),
            "@mongodb-js/devtools-proxy-support": localPolyfill("@mongodb-js/devtools-proxy-support"),
            "node:process": localPolyfill("process"),
            process: localPolyfill("process"),
            events: localPolyfill("events"),
            buffer: require.resolve("buffer/"),
            "node:buffer": require.resolve("buffer/"),
            crypto: require.resolve("crypto-browserify"),
            util: require.resolve("util/"),
            "fs/promises": localPolyfill("fs/promises"),
            fs: localPolyfill("fs"),
            path: require.resolve("path-browserify"),
            os: require.resolve("os-browserify/browser"),
            // Node.js builtin protocol aliases (node:*)
            "node:stream/promises": localPolyfill("stream/promises"),
            "node:stream/web": require.resolve("readable-stream"),
            "stream/promises": localPolyfill("stream/promises"),
            stream: require.resolve("readable-stream"),
            "node:stream": require.resolve("readable-stream"),
            "node:events": localPolyfill("events"),
            "node:crypto": require.resolve("crypto-browserify"),
            "node:util": require.resolve("util/"),
            "node:fs/promises": localPolyfill("fs/promises"),
            "node:fs": localPolyfill("fs"),
            "node:path": require.resolve("path-browserify"),
            "@mongodb-js/atlas-local": emptyPolyfill(),
            "kerberos/package.json": throwErrorPolyfill(),
            kerberos: throwErrorPolyfill(),
            "mongodb-client-encryption/package.json": throwErrorPolyfill(),
            "mongodb-client-encryption": throwErrorPolyfill(),
            "mongodb-mcp-server/web": require.resolve("../../src/web.ts"),
            express: emptyPolyfill(),
            http: emptyPolyfill(),
            "node:http": emptyPolyfill(),
            // Built-in Node.js modules imported by the driver directly and used in
            // ways that requires us to provide a no-op polyfill
            zlib: localPolyfill("zlib"),
        },
    },
});

function localPolyfill(packageName: string): string {
    return path.resolve(__dirname, "polyfills", packageName, "index.ts");
}

function emptyPolyfill(): string {
    return path.resolve(__dirname, "polyfills", "empty.ts");
}

function throwErrorPolyfill(): string {
    return path.resolve(__dirname, "polyfills", "throwError.ts");
}
