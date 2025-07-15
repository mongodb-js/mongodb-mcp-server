import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("CommonJS module import", { timeout: 5000 }, (t) => {
    const require = createRequire(__filename);
    const cjsPath = path.resolve(__dirname, "../../dist/cjs/index.js");

    const cjsModule = require(cjsPath);

    assert.equal(typeof cjsModule, "object", "CommonJS module should be an object");
    assert.ok(cjsModule, "CommonJS module should be truthy");
});

test("ESM module import", { timeout: 5000 }, async (t) => {
    const esmPath = path.resolve(__dirname, "../../dist/esm/d.js");

    const esmModule = await import(esmPath);

    assert.equal(typeof esmModule, "object", "ESM module should be an object");
    assert.ok(esmModule, "ESM module should be truthy");
});

test("module exports comparison", { timeout: 5000 }, async () => {
    const require = createRequire(__filename);
    const cjsPath = path.resolve(__dirname, "../../dist/cjs/index.js");
    const esmPath = path.resolve(__dirname, "../../dist/esm/d.js");

    const cjsModule = require(cjsPath);
    const esmModule = await import(esmPath);

    const cjsKeys = Object.keys(cjsModule).sort();
    const esmKeys = Object.keys(esmModule).sort();

    assert.deepEqual(
        cjsKeys,
        esmKeys,
        `CommonJS and ESM modules should export the same keys.\nCommonJS: ${JSON.stringify(cjsKeys)}\nESM: ${JSON.stringify(esmKeys)}`
    );
});
