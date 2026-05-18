#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "..", "src", "mongot-community-setup");
const destDir = path.join(__dirname, "..", "dist", "mongot-community-setup");

// Create destination directory if it doesn't exist
fs.mkdirSync(destDir, { recursive: true });

// Copy the directory recursively
fs.cpSync(srcDir, destDir, { recursive: true, dereference: true });

console.log("Copied mongot-community-setup to dist/");
