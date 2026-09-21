import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexHarnessConfig, seedCodexOAuthCredentials } from "./codexConfig.js";
import { oauthCredentialStoreKey } from "../shared.js";
import type { AgentHarnessOptions } from "../types.js";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-config-test-"));
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

function buildConfig(options: AgentHarnessOptions): string {
    return new CodexHarnessConfig().buildConfig(options, makeTmpDir());
}

describe("CodexHarnessConfig", () => {
    it("emits http_headers for a remote server", () => {
        const config = buildConfig(buildOptions({ headers: { Authorization: "Bearer token" } }));
        expect(config).toContain("[mcp_servers.mongo.http_headers]");
        expect(config).toContain('"Authorization" = "Bearer token"');
    });

    it("omits http_headers when none are configured", () => {
        expect(buildConfig(buildOptions())).not.toContain("[mcp_servers.mongo.http_headers]");
    });

    it("forces the file credential store only when oauth is seeded", () => {
        expect(buildConfig(buildOptions({ oauth: { accessToken: "t" } }))).toContain(
            'mcp_oauth_credentials_store = "file"'
        );
        expect(buildConfig(buildOptions())).not.toContain("mcp_oauth_credentials_store");
    });
});

describe("seedCodexOAuthCredentials", () => {
    it("writes the credential entry under the store key", () => {
        const homeDir = makeTmpDir();
        const options = buildOptions({
            oauth: {
                accessToken: "access",
                refreshToken: "refresh",
                expiresAt: 1234,
                clientId: "client",
                scopes: ["a"],
                issuer: "https://auth.test",
            },
        });

        seedCodexOAuthCredentials({ homeDir, options });

        const store = JSON.parse(fs.readFileSync(path.join(homeDir, ".credentials.json"), "utf8")) as Record<
            string,
            Record<string, unknown>
        >;
        const key = oauthCredentialStoreKey({ serverName: "mongo", serverUrl: "https://example.test/mcp" });
        expect(store[key]).toEqual({
            server_name: "mongo",
            server_url: "https://example.test/mcp",
            issuer: "https://auth.test",
            client_id: "client",
            access_token: "access",
            expires_at: 1234,
            refresh_token: "refresh",
            scopes: ["a"],
        });
    });

    it("defaults client_id and scopes and preserves existing entries", () => {
        const homeDir = makeTmpDir();
        fs.writeFileSync(
            path.join(homeDir, ".credentials.json"),
            JSON.stringify({ "other|abc": { server_name: "other" } })
        );

        seedCodexOAuthCredentials({ homeDir, options: buildOptions({ oauth: { accessToken: "access" } }) });

        const store = JSON.parse(fs.readFileSync(path.join(homeDir, ".credentials.json"), "utf8")) as Record<
            string,
            Record<string, unknown>
        >;
        expect(store["other|abc"]).toEqual({ server_name: "other" });
        const key = oauthCredentialStoreKey({ serverName: "mongo", serverUrl: "https://example.test/mcp" });
        expect(store[key]).toEqual({
            server_name: "mongo",
            server_url: "https://example.test/mcp",
            client_id: "",
            access_token: "access",
            scopes: [],
        });
    });

    it("does nothing when oauth is absent", () => {
        const homeDir = makeTmpDir();
        seedCodexOAuthCredentials({ homeDir, options: buildOptions() });
        expect(fs.existsSync(path.join(homeDir, ".credentials.json"))).toBe(false);
    });
});
