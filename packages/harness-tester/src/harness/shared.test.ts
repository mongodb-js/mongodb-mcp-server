import { describe, expect, it } from "vitest";
import { assertRemoteServerOptions, oauthCredentialStoreKey } from "./shared.js";

describe("oauthCredentialStoreKey", () => {
    // Vectors taken from real claude credential-store entries (name -> hash), which
    // pin the exact payload field order ({type,url,headers}) and hash truncation.
    it("matches known claude credential-store keys", () => {
        expect(oauthCredentialStoreKey({ serverName: "mixpanel", serverUrl: "https://mcp.mixpanel.com/mcp" })).toBe(
            "mixpanel|377165373322cdb8"
        );
        expect(oauthCredentialStoreKey({ serverName: "mongodb-prod", serverUrl: "https://mcp.mongodb.com" })).toBe(
            "mongodb-prod|3216c2283dd9772e"
        );
    });

    it("includes headers in the key", () => {
        const withoutHeaders = oauthCredentialStoreKey({ serverName: "s", serverUrl: "https://h/mcp" });
        const withHeaders = oauthCredentialStoreKey({
            serverName: "s",
            serverUrl: "https://h/mcp",
            headers: { Authorization: "Bearer t" },
        });
        expect(withHeaders).not.toBe(withoutHeaders);
    });
});

describe("assertRemoteServerOptions", () => {
    it("allows oauth on a remote server", () => {
        expect(() =>
            assertRemoteServerOptions({ workDir: "/tmp", serverUrl: "https://h/mcp", oauth: { accessToken: "t" } })
        ).not.toThrow();
    });

    it("rejects oauth with a stdio server", () => {
        expect(() =>
            assertRemoteServerOptions({
                workDir: "/tmp",
                stdioServer: { command: "x", args: [], env: {} },
                oauth: { accessToken: "t" },
            })
        ).toThrow(/stdioServer/);
    });

    it("rejects oauth without a server URL", () => {
        expect(() => assertRemoteServerOptions({ workDir: "/tmp", oauth: { accessToken: "t" } })).toThrow(/serverUrl/);
    });
});
