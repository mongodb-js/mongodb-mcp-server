#!/usr/bin/env tsx

import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const distDir = resolve("dist");

// ESM package.json
const esmPath = resolve(distDir, "esm", "package.json");
mkdirSync(resolve(distDir, "esm"), { recursive: true });
writeFileSync(esmPath, JSON.stringify({ type: "module" }));

// CJS package.json
const cjsPath = resolve(distDir, "cjs", "package.json");
mkdirSync(resolve(distDir, "cjs"), { recursive: true });
writeFileSync(cjsPath, JSON.stringify({ type: "commonjs" }));
