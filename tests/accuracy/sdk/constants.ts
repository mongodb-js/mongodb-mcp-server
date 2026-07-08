import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(import.meta.url);

export const ROOT_DIR = path.join(__dirname, "..", "..", "..", "..");

export const DIST_DIR = path.join(ROOT_DIR, "dist");

export const RESOURCES_DIR = path.join(ROOT_DIR, "resources");

export const MCP_SERVER_CLI_SCRIPT = path.join(DIST_DIR, "index.js");

export const GENERATED_ASSETS_DIR = path.join(ROOT_DIR, ".accuracy");

export const ACCURACY_RESULTS_DIR = path.join(GENERATED_ASSETS_DIR, "results");

export const LATEST_ACCURACY_RUN_NAME = "latest-run";

export const HTML_TEST_SUMMARY_FILE = path.join(GENERATED_ASSETS_DIR, "test-summary.html");

export const MARKDOWN_TEST_BRIEF_FILE = path.join(GENERATED_ASSETS_DIR, "test-brief.md");

/** When MDB_ACCURACY_SUMMARY_LABEL is set, summaries are written to labeled paths so A/B runs don't overwrite each other. */
export function getHtmlTestSummaryFile(label?: string): string {
    const sanitized = label?.replace(/[^a-zA-Z0-9-_]/g, "-");
    return sanitized ? path.join(GENERATED_ASSETS_DIR, `test-summary-${sanitized}.html`) : HTML_TEST_SUMMARY_FILE;
}

export function getMarkdownTestBriefFile(label?: string): string {
    const sanitized = label?.replace(/[^a-zA-Z0-9-_]/g, "-");
    return sanitized ? path.join(GENERATED_ASSETS_DIR, `test-brief-${sanitized}.md`) : MARKDOWN_TEST_BRIEF_FILE;
}

export const HTML_TESTS_SUMMARY_TEMPLATE = path.join(RESOURCES_DIR, "test-summary-template.html");
