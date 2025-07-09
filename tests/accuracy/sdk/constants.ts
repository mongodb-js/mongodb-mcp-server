import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(import.meta.url);

export const ROOT_DIR = path.join(__dirname, "..", "..", "..", "..");

export const DIST_DIR = path.join(ROOT_DIR, "dist");

export const MCP_SERVER_CLI_SCRIPT = path.join(DIST_DIR, "index.js");

export const TEST_DATA_DUMPS_DIR = path.join(__dirname, "test-data-dumps");

export const GENERATED_ASSETS_DIR = path.join(ROOT_DIR, ".accuracy");

export const LOCAL_SNAPSHOTS_FILE = path.join(GENERATED_ASSETS_DIR, "snapshots.json");

export const HTML_REPORT_FILE = path.join(GENERATED_ASSETS_DIR, "report.html");
