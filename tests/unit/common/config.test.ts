import { describe, it, expect } from "vitest";
import { setupUserConfig, UserConfig } from "../../../src/common/config.js";

describe.only("config", () => {
    describe("env var parsing", () => {
        describe("string cases", () => {
            const testCases = {
                MDB_MCP_API_BASE_URL: "apiBaseUrl",
                MDB_MCP_API_CLIENT_ID: "apiClientId",
                MDB_MCP_API_CLIENT_SECRET: "apiClientSecret",
                MDB_MCP_TELEMETRY: "telemetry",
                MDB_MCP_LOG_PATH: "logPath",
                MDB_MCP_CONNECTION_STRING: "connectionString",
                MDB_MCP_READ_ONLY: "readOnly",
                MDB_MCP_INDEX_CHECK: "indexCheck",
                MDB_MCP_TRANSPORT: "transport",
                MDB_MCP_HTTP_PORT: "httpPort",
                MDB_MCP_HTTP_HOST: "httpHost",
                MDB_MCP_IDLE_TIMEOUT_MS: "idleTimeoutMs",
                MDB_MCP_NOTIFICATION_TIMEOUT_MS: "notificationTimeoutMs",
            } as const;

            for (const [envVar, config] of Object.entries(testCases)) {
                it(`should map ${envVar} to ${config}`, () => {
                    const randomValue = "value=" + Math.random();

                    const actual = setupUserConfig({
                        cli: [],
                        env: {
                            [envVar]: randomValue,
                        },
                        defaults: {},
                    });

                    expect(actual[config]).toBe(randomValue);
                });
            }
        });

        describe("array cases", () => {
            const testCases = {
                MDB_MCP_DISABLED_TOOLS: "disabledTools",
                MDB_MCP_LOGGERS: "loggers",
            } as const;

            for (const [envVar, config] of Object.entries(testCases)) {
                it(`should map ${envVar} to ${config}`, () => {
                    const randomValue = "value=" + Math.random();

                    const actual = setupUserConfig({
                        cli: [],
                        env: {
                            [envVar]: randomValue,
                        },
                        defaults: {},
                    });

                    expect(actual[config]).toEqual([randomValue]);
                });
            }
        });
    });

    describe("cli parsing", () => {
        describe("string use cases", () => {
            const testCases = [
                {
                    cli: ["--apiBaseUrl", "http://some-url.com"],
                    expected: { apiBaseUrl: "http://some-url.com" },
                },
                {
                    cli: ["--apiClientId", "OmgSoIdYeah"],
                    expected: { apiClientId: "OmgSoIdYeah" },
                },
                {
                    cli: ["--apiClientSecret", "OmgSoSecretYeah"],
                    expected: { apiClientSecret: "OmgSoSecretYeah" },
                },
                {
                    cli: ["--connectionString", "mongodb://localhost"],
                    expected: { connectionString: "mongodb://localhost" },
                },
                {
                    cli: ["--httpHost", "mongodb://localhost"],
                    expected: { httpHost: "mongodb://localhost" },
                },
                {
                    cli: ["--httpPort", "8080"],
                    expected: { httpPort: "8080" },
                },
                {
                    cli: ["--idleTimeoutMs", "42"],
                    expected: { idleTimeoutMs: "42" },
                },
                {
                    cli: ["--logPath", "/var/"],
                    expected: { logPath: "/var/" },
                },
                {
                    cli: ["--notificationTimeoutMs", "42"],
                    expected: { notificationTimeoutMs: "42" },
                },
                {
                    cli: ["--telemetry", "obviously"],
                    expected: { telemetry: "obviously" },
                },
                {
                    cli: ["--transport", "stdio"],
                    expected: { transport: "stdio" },
                },
                {
                    cli: ["--apiVersion", "1"],
                    expected: { apiVersion: "1" },
                },
                {
                    cli: ["--authenticationDatabase", "admin"],
                    expected: { authenticationDatabase: "admin" },
                },
                {
                    cli: ["--authenticationMechanism", "PLAIN"],
                    expected: { authenticationMechanism: "PLAIN" },
                },
                {
                    cli: ["--browser", "firefox"],
                    expected: { browser: "firefox" },
                },
                {
                    cli: ["--db", "test"],
                    expected: { db: "test" },
                },
                {
                    cli: ["--gssapiHostName", "localhost"],
                    expected: { gssapiHostName: "localhost" },
                },
                {
                    cli: ["--gssapiServiceName", "SERVICE"],
                    expected: { gssapiServiceName: "SERVICE" },
                },
                {
                    cli: ["--host", "localhost"],
                    expected: { host: "localhost" },
                },
                {
                    cli: ["--oidcFlows", "device"],
                    expected: { oidcFlows: "device" },
                },
                {
                    cli: ["--oidcRedirectUri", "https://oidc"],
                    expected: { oidcRedirectUri: "https://oidc" },
                },
                {
                    cli: ["--password", "123456"],
                    expected: { password: "123456" },
                },
                {
                    cli: ["--port", "27017"],
                    expected: { port: "27017" },
                },
                {
                    cli: ["--sslCAFile", "/var/file"],
                    expected: { sslCAFile: "/var/file" },
                },
                {
                    cli: ["--sslCRLFile", "/var/file"],
                    expected: { sslCRLFile: "/var/file" },
                },
                {
                    cli: ["--sslCertificateSelector", "pem=pom"],
                    expected: { sslCertificateSelector: "pem=pom" },
                },
                {
                    cli: ["--sslDisabledProtocols", "tls1"],
                    expected: { sslDisabledProtocols: "tls1" },
                },
                {
                    cli: ["--sslPEMKeyFile", "/var/pem"],
                    expected: { sslPEMKeyFile: "/var/pem" },
                },
                {
                    cli: ["--sslPEMKeyPassword", "654321"],
                    expected: { sslPEMKeyPassword: "654321" },
                },
                {
                    cli: ["--sspiHostnameCanonicalization", "true"],
                    expected: { sspiHostnameCanonicalization: "true" },
                },
                {
                    cli: ["--sspiRealmOverride", "OVER9000!"],
                    expected: { sspiRealmOverride: "OVER9000!" },
                },
                {
                    cli: ["--tlsCAFile", "/var/file"],
                    expected: { tlsCAFile: "/var/file" },
                },
                {
                    cli: ["--tlsCRLFile", "/var/file"],
                    expected: { tlsCRLFile: "/var/file" },
                },
                {
                    cli: ["--tlsCertificateKeyFile", "/var/file"],
                    expected: { tlsCertificateKeyFile: "/var/file" },
                },
                {
                    cli: ["--tlsCertificateKeyFilePassword", "4242"],
                    expected: { tlsCertificateKeyFilePassword: "4242" },
                },
                {
                    cli: ["--tlsCertificateSelector", "pom=pum"],
                    expected: { tlsCertificateSelector: "pom=pum" },
                },
                {
                    cli: ["--tlsDisabledProtocols", "tls1"],
                    expected: { tlsDisabledProtocols: "tls1" },
                },
                {
                    cli: ["--username", "admin"],
                    expected: { username: "admin" },
                },
            ] as { cli: string[]; expected: Partial<UserConfig> }[];

            for (const { cli, expected } of testCases) {
                it(`should parse '${cli.join(" ")}' to ${JSON.stringify(expected)}`, () => {
                    const actual = setupUserConfig({
                        cli: ["myself", "--", ...cli],
                        env: {},
                        defaults: {},
                    });

                    for (const [key, value] of Object.entries(expected)) {
                        expect(actual[key as keyof UserConfig]).toBe(value as unknown);
                    }
                });
            }
        });

        describe("boolean use cases", () => {
            const testCases = [
                {
                    cli: ["--apiDeprecationErrors"],
                    expected: { apiDeprecationErrors: true },
                },
                {
                    cli: ["--apiStrict"],
                    expected: { apiStrict: true },
                },
                {
                    cli: ["--help"],
                    expected: { help: true },
                },
                {
                    cli: ["--indexCheck"],
                    expected: { indexCheck: true },
                },
                {
                    cli: ["--ipv6"],
                    expected: { ipv6: true },
                },
                {
                    cli: ["--nodb"],
                    expected: { nodb: true },
                },
                {
                    cli: ["--oidcIdTokenAsAccessToken"],
                    expected: { oidcIdTokenAsAccessToken: true },
                },
                {
                    cli: ["--oidcNoNonce"],
                    expected: { oidcNoNonce: true },
                },
                {
                    cli: ["--oidcTrustedEndpoint"],
                    expected: { oidcTrustedEndpoint: true },
                },
                {
                    cli: ["--readOnly"],
                    expected: { readOnly: true },
                },
                {
                    cli: ["--retryWrites"],
                    expected: { retryWrites: true },
                },
                {
                    cli: ["--ssl"],
                    expected: { ssl: true },
                },
                {
                    cli: ["--sslAllowInvalidCertificates"],
                    expected: { sslAllowInvalidCertificates: true },
                },
                {
                    cli: ["--sslAllowInvalidHostnames"],
                    expected: { sslAllowInvalidHostnames: true },
                },
                {
                    cli: ["--sslFIPSMode"],
                    expected: { sslFIPSMode: true },
                },
                {
                    cli: ["--tls"],
                    expected: { tls: true },
                },
                {
                    cli: ["--tlsAllowInvalidCertificates"],
                    expected: { tlsAllowInvalidCertificates: true },
                },
                {
                    cli: ["--tlsAllowInvalidHostnames"],
                    expected: { tlsAllowInvalidHostnames: true },
                },
                {
                    cli: ["--tlsFIPSMode"],
                    expected: { tlsFIPSMode: true },
                },
                {
                    cli: ["--tlsUseSystemCA"],
                    expected: { tlsUseSystemCA: true },
                },
                {
                    cli: ["--version"],
                    expected: { version: true },
                },
            ] as { cli: string[]; expected: Partial<UserConfig> }[];

            for (const { cli, expected } of testCases) {
                it(`should parse '${cli.join(" ")}' to ${JSON.stringify(expected)}`, () => {
                    const actual = setupUserConfig({
                        cli: ["myself", "--", ...cli],
                        env: {},
                        defaults: {},
                    });

                    for (const [key, value] of Object.entries(expected)) {
                        expect(actual[key as keyof UserConfig]).toBe(value as unknown);
                    }
                });
            }
        });

        describe("array use cases", () => {
            const testCases = [
                {
                    cli: ["--disabledTools", "some,tool"],
                    expected: { disabledTools: ["some", "tool"] },
                },
                {
                    cli: ["--loggers", "canada,file"],
                    expected: { loggers: ["canada", "file"] },
                },
            ] as { cli: string[]; expected: Partial<UserConfig> }[];

            for (const { cli, expected } of testCases) {
                it(`should parse '${cli.join(" ")}' to ${JSON.stringify(expected)}`, () => {
                    const actual = setupUserConfig({
                        cli: ["myself", "--", ...cli],
                        env: {},
                        defaults: {},
                    });

                    for (const [key, value] of Object.entries(expected)) {
                        expect(actual[key as keyof UserConfig]).toEqual(value as unknown);
                    }
                });
            }
        });
    });

    describe("precende rules", () => {
        it("cli arguments take precedence over env vars", () => {
            const actual = setupUserConfig({
                cli: ["myself", "--", "--connectionString", "mongodb://localhost"],
                env: { MDB_MCP_CONNECTION_STRING: "mongodb://crazyhost" },
                defaults: {},
            });

            expect(actual.connectionString).toBe("mongodb://localhost");
        });

        it("any cli argument takes precedence over defaults", () => {
            const actual = setupUserConfig({
                cli: ["myself", "--", "--connectionString", "mongodb://localhost"],
                env: {},
                defaults: {
                    connectionString: "mongodb://crazyhost",
                },
            });

            expect(actual.connectionString).toBe("mongodb://localhost");
        });

        it("any env var takes precedence over defaults", () => {
            const actual = setupUserConfig({
                cli: [],
                env: { MDB_MCP_CONNECTION_STRING: "mongodb://localhost" },
                defaults: {
                    connectionString: "mongodb://crazyhost",
                },
            });

            expect(actual.connectionString).toBe("mongodb://localhost");
        });
    });

    describe("consolidation", () => {
        it("positional argument for url has precedence over --connectionString", () => {
            const actual = setupUserConfig({
                cli: ["myself", "--", "mongodb://localhost", "--connectionString", "toRemove"],
                env: {},
                defaults: {},
            });

            expect(actual.connectionString).toBe(undefined);
            expect(actual.connectionSpecifier).toBe("mongodb://localhost");
        });
    });
});
