import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AGENT_ENV_VARS = [
    "CLAUDECODE",
    "CURSOR_AGENT",
    "GEMINI_CLI",
    "CODEX_SANDBOX",
    "AUGMENT_AGENT",
    "CLINE_ACTIVE",
    "OPENCODE_CLIENT",
    "TRAE_AI_SHELL_ID",
    "AGENT",
];

// The module caches its result in a module-level variable, so we reload it
// between tests using vi.resetModules().
async function importFresh(): Promise<() => Promise<string | undefined>> {
    vi.resetModules();
    const mod = await import("../../../src/helpers/agentDetection.js");
    return mod.detectAgentEnvVar;
}

let savedEnvVars: Partial<NodeJS.ProcessEnv>;

beforeEach(() => {
    // Save and clear all agent env vars so each test starts from a clean state.
    savedEnvVars = {};
    for (const key of AGENT_ENV_VARS) {
        savedEnvVars[key] = process.env[key];
        delete process.env[key];
    }
});

afterEach(() => {
    // Restore original env vars.
    for (const key of AGENT_ENV_VARS) {
        if (savedEnvVars[key] !== undefined) {
            process.env[key] = savedEnvVars[key];
        } else {
            delete process.env[key];
        }
    }
    vi.resetModules();
});

describe("detectAgentEnvVar", () => {
    it("returns undefined when no agent env var is set", async () => {
        vi.doMock("fs/promises", () => ({
            default: { access: vi.fn().mockRejectedValue(new Error("ENOENT")) },
        }));

        const detectAgentEnvVar = await importFresh();
        expect(await detectAgentEnvVar()).toBeUndefined();
    });

    it.each([
        { envVar: "CLAUDECODE", value: "1", expected: "claude_code" },
        { envVar: "CURSOR_AGENT", value: "1", expected: "cursor" },
        { envVar: "GEMINI_CLI", value: "1", expected: "gemini_cli" },
        { envVar: "CODEX_SANDBOX", value: "seatbelt", expected: "codex_cli" },
        { envVar: "AUGMENT_AGENT", value: "1", expected: "augment" },
        { envVar: "CLINE_ACTIVE", value: "true", expected: "cline" },
        { envVar: "OPENCODE_CLIENT", value: "1", expected: "opencode_client" },
        { envVar: "TRAE_AI_SHELL_ID", value: "some-session-id", expected: "trae_ai" },
    ])("returns '$expected' when $envVar=$value", async ({ envVar, value, expected }) => {
        process.env[envVar] = value;
        const detectAgentEnvVar = await importFresh();
        expect(await detectAgentEnvVar()).toBe(expected);
    });

    it("returns 'amp' when AGENT=amp", async () => {
        process.env.AGENT = "amp";
        const detectAgentEnvVar = await importFresh();
        expect(await detectAgentEnvVar()).toBe("amp");
    });

    it("returns 'goose' when AGENT=goose", async () => {
        process.env.AGENT = "goose";
        const detectAgentEnvVar = await importFresh();
        expect(await detectAgentEnvVar()).toBe("goose");
    });

    it("returns undefined when AGENT has an unknown value", async () => {
        process.env.AGENT = "other-tool";
        vi.doMock("fs/promises", () => ({
            default: { access: vi.fn().mockRejectedValue(new Error("ENOENT")) },
        }));
        const detectAgentEnvVar = await importFresh();
        expect(await detectAgentEnvVar()).toBeUndefined();
    });

    it("returns 'devin' when /opt/.devin exists", async () => {
        vi.doMock("fs/promises", () => ({
            default: { access: vi.fn().mockResolvedValue(undefined) },
        }));
        const detectAgentEnvVar = await importFresh();
        expect(await detectAgentEnvVar()).toBe("devin");
    });

    it("does not match CODEX_SANDBOX with a value other than 'seatbelt'", async () => {
        process.env.CODEX_SANDBOX = "other";
        vi.doMock("fs/promises", () => ({
            default: { access: vi.fn().mockRejectedValue(new Error("ENOENT")) },
        }));
        const detectAgentEnvVar = await importFresh();
        expect(await detectAgentEnvVar()).toBeUndefined();
    });

    it("returns the first match when multiple env vars are set", async () => {
        // CLAUDECODE is checked before CURSOR_AGENT in the list.
        process.env.CLAUDECODE = "1";
        process.env.CURSOR_AGENT = "1";
        const detectAgentEnvVar = await importFresh();
        expect(await detectAgentEnvVar()).toBe("claude_code");
    });

    it("caches the result across multiple calls", async () => {
        process.env.CLAUDECODE = "1";
        const detectAgentEnvVar = await importFresh();
        const first = await detectAgentEnvVar();
        // Change the env var — cached result should still be returned.
        delete process.env.CLAUDECODE;
        const second = await detectAgentEnvVar();
        expect(first).toBe("claude_code");
        expect(second).toBe("claude_code");
    });
});
