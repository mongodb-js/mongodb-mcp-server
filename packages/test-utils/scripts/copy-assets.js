#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.join(__dirname, "..", "src", "mongot-community-setup");
const destDir = path.join(__dirname, "..", "dist", "mongot-community-setup");

// Create destination directory if it doesn't exist
fs.mkdirSync(destDir, { recursive: true });

// Copy the directory recursively
fs.cpSync(srcDir, destDir, { recursive: true, dereference: true });

console.log("Copied mongot-community-setup to dist/");
