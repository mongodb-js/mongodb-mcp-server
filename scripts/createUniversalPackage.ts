#!/usr/bin/env tsx

import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const distDir = resolve("dist");

/**
 * Node uses the package.json to know whether files with a .js extensions
 * should be interpreted as CommonJS or ESM.
 */
// ESM package.json
const esmPath = resolve(distDir, "esm", "package.json");
mkdirSync(resolve(distDir, "esm"), { recursive: true });
writeFileSync(esmPath, JSON.stringify({ type: "module" }));

// CJS package.json
const cjsPath = resolve(distDir, "cjs", "package.json");
mkdirSync(resolve(distDir, "cjs"), { recursive: true });
writeFileSync(cjsPath, JSON.stringify({ type: "commonjs" }));

// Create a dist/index.js file that imports the ESM index.js file
// To minimize breaking changes from pre-universal package time.
const indexPath = resolve(distDir, "index.js");
writeFileSync(indexPath, `import "./esm/index.js";`);
