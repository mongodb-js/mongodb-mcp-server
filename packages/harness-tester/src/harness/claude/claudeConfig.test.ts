import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeHarnessConfig, seedClaudeOAuthCredentials } from "./claudeConfig.js";
import { oauthCredentialStoreKey } from "../shared.js";
import type { AgentHarnessOptions } from "../types.js";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-config-test-"));
    tmpDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function buildOptions(overrides: Partial<AgentHarnessOptions> = {}): AgentHarnessOptions {
    return { workDir: makeTmpDir(), serverUrl: "https://example.test/mcp", mcpServerName: "mongo", ...overrides };
}

function parseMcpServer(config: string): unknown {
    const parsed = JSON.parse(config) as { mcpServers: Record<string, unknown> };
    return parsed.mcpServers["mongo"];
}

describe("ClaudeHarnessConfig", () => {
    it("emits http headers for a remote server", () => {
        const config = new ClaudeHarnessConfig().buildConfig(
            buildOptions({ headers: { Authorization: "Bearer token" } })
        );
        expect(parseMcpServer(config)).toEqual({
            type: "http",
            url: "https://example.test/mcp",
            headers: { Authorization: "Bearer token" },
        });
    });

    it("omits headers when none are configured", () => {
        const config = new ClaudeHarnessConfig().buildConfig(buildOptions());
        expect(parseMcpServer(config)).toEqual({ type: "http", url: "https://example.test/mcp" });
    });
});

describe("seedClaudeOAuthCredentials", () => {
    it("writes the mcpOAuth entry under the store key", () => {
        const homeDir = makeTmpDir();
        const options = buildOptions({
            oauth: {
                accessToken: "access",
                refreshToken: "refresh",
                expiresAt: 1234,
                clientId: "client",
                issuer: "https://auth.test",
            },
        });

        seedClaudeOAuthCredentials({ homeDir, options });

        const credentials = JSON.parse(fs.readFileSync(path.join(homeDir, ".credentials.json"), "utf8")) as {
            mcpOAuth: Record<string, Record<string, unknown>>;
        };
        const key = oauthCredentialStoreKey({
            serverName: "mongo",
            serverUrl: "https://example.test/mcp",
        });
        expect(credentials.mcpOAuth[key]).toEqual({
            serverName: "mongo",
            serverUrl: "https://example.test/mcp",
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: 1234,
            clientId: "client",
            issuer: "https://auth.test",
            discoveryState: { authorizationServerUrl: "https://auth.test" },
        });
    });

    it("does not fabricate a discovery URL when issuer is absent", () => {
        const homeDir = makeTmpDir();
        seedClaudeOAuthCredentials({ homeDir, options: buildOptions({ oauth: { accessToken: "access" } }) });

        const credentials = JSON.parse(fs.readFileSync(path.join(homeDir, ".credentials.json"), "utf8")) as {
            mcpOAuth: Record<string, Record<string, unknown>>;
        };
        const key = oauthCredentialStoreKey({ serverName: "mongo", serverUrl: "https://example.test/mcp" });
        const entry = credentials.mcpOAuth[key];
        expect(entry).toEqual({
            serverName: "mongo",
            serverUrl: "https://example.test/mcp",
            accessToken: "access",
        });
        expect(entry!.discoveryState).toBeUndefined();
    });

    it("preserves sibling keys and is a no-op without oauth", () => {
        const homeDir = makeTmpDir();
        fs.writeFileSync(
            path.join(homeDir, ".credentials.json"),
            JSON.stringify({ claudeAiOauth: { accessToken: "existing" }, mcpOAuth: { other: { accessToken: "x" } } })
        );

        seedClaudeOAuthCredentials({ homeDir, options: buildOptions({ oauth: { accessToken: "new" } }) });

        const credentials = JSON.parse(fs.readFileSync(path.join(homeDir, ".credentials.json"), "utf8")) as {
            claudeAiOauth: unknown;
            mcpOAuth: Record<string, unknown>;
        };
        expect(credentials.claudeAiOauth).toEqual({ accessToken: "existing" });
        expect(credentials.mcpOAuth["other"]).toEqual({ accessToken: "x" });
    });

    it("does nothing when oauth is absent", () => {
        const homeDir = makeTmpDir();
        seedClaudeOAuthCredentials({ homeDir, options: buildOptions() });
        expect(fs.existsSync(path.join(homeDir, ".credentials.json"))).toBe(false);
    });
});
