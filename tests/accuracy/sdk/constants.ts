import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(import.meta.url);

export const ROOT_DIR = path.join(__dirname, "..", "..", "..", "..");

export const DIST_DIR = path.join(ROOT_DIR, "dist");

export const RESOURCES_DIR = path.join(ROOT_DIR, "resources");

export const MCP_SERVER_CLI_SCRIPT = path.join(DIST_DIR, "index.js");

export const TEST_DATA_DUMPS_DIR = path.join(__dirname, "test-data-dumps");

export const GENERATED_ASSETS_DIR = path.join(ROOT_DIR, ".accuracy");

export const ACCURACY_RESULTS_DIR = path.join(GENERATED_ASSETS_DIR, "results");

export const LATEST_ACCURACY_RUN_NAME = "latest-run";

export const HTML_TEST_SUMMARY_FILE = path.join(GENERATED_ASSETS_DIR, "test-summary.html");

export const MARKDOWN_TEST_BRIEF_FILE = path.join(GENERATED_ASSETS_DIR, "test-brief.md");

export const HTML_TESTS_SUMMARY_TEMPLATE = path.join(RESOURCES_DIR, "test-summary-template.html");
