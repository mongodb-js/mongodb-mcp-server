import fs from "fs/promises";

// Env var checks evaluated in order; first match wins.
const ENV_CHECKS: Array<{ envVar: string; expectedValue: string | null; telemetryValue: string }> = [
    { envVar: "CLAUDECODE", expectedValue: "1", telemetryValue: "claude_code" },
    { envVar: "CURSOR_AGENT", expectedValue: "1", telemetryValue: "cursor" },
    { envVar: "GEMINI_CLI", expectedValue: "1", telemetryValue: "gemini_cli" },
    { envVar: "CODEX_SANDBOX", expectedValue: "seatbelt", telemetryValue: "codex_cli" },
    { envVar: "AUGMENT_AGENT", expectedValue: "1", telemetryValue: "augment" },
    { envVar: "CLINE_ACTIVE", expectedValue: "true", telemetryValue: "cline" },
    { envVar: "OPENCODE_CLIENT", expectedValue: "1", telemetryValue: "opencode_client" },
    // TRAE_AI_SHELL_ID carries a session id — any non-empty value qualifies.
    { envVar: "TRAE_AI_SHELL_ID", expectedValue: null, telemetryValue: "trae_ai" },
];

// null = not yet resolved; undefined = resolved, no agent detected
let cachedAgentEnvVar: string | undefined | null = null;

export async function detectAgentEnvVar(): Promise<string | undefined> {
    if (cachedAgentEnvVar !== null) {
        return cachedAgentEnvVar;
    }

    cachedAgentEnvVar = await detect();
    return cachedAgentEnvVar;
}

async function detect(): Promise<string | undefined> {
    if (typeof process === "undefined" || !process.env) {
        return undefined;
    }

    for (const { envVar, expectedValue, telemetryValue } of ENV_CHECKS) {
        const value = process.env[envVar];
        if (value !== undefined && (expectedValue === null ? value.length > 0 : value === expectedValue)) {
            return telemetryValue;
        }
    }

    // AGENT is shared by amp and goose; distinguish by value.
    const agentValue = process.env.AGENT;
    if (agentValue === "amp") return "amp";
    if (agentValue === "goose") return "goose";

    // Devin is detected via a filesystem marker rather than an env var.
    try {
        await fs.access("/opt/.devin");
        return "devin";
    } catch {
        return undefined;
    }
}
