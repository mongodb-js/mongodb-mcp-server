import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UserConfig } from "../../../src/common/config.js";
import {
    setupUserConfig,
    defaultUserConfig,
    registerKnownSecretsInRootKeychain,
    warnAboutDeprecatedOrUnknownCliArgs,
} from "../../../src/common/config.js";
import type { CliOptions } from "@mongosh/arg-parser";
import { Keychain } from "../../../src/common/keychain.js";
import type { Secret } from "../../../src/common/keychain.js";

describe("config", () => {
    describe("env var parsing", () => {
        describe("mongodb urls", () => {
            it("should not try to parse a multiple-host urls", () => {
                const actual = setupUserConfig({
                    env: {
                        MDB_MCP_CONNECTION_STRING: "mongodb://user:password@host1,host2,host3/",
                    },
                    cli: [],
                    defaults: defaultUserConfig,
                });

                expect(actual.connectionString).toEqual("mongodb://user:password@host1,host2,host3/");
            });
        });

        describe("string cases", () => {
            const testCases = [
                { envVar: "MDB_MCP_API_BASE_URL", property: "apiBaseUrl", value: "http://test.com" },
                { envVar: "MDB_MCP_API_CLIENT_ID", property: "apiClientId", value: "ClientIdLol" },
                { envVar: "MDB_MCP_API_CLIENT_SECRET", property: "apiClientSecret", value: "SuperClientSecret" },
                { envVar: "MDB_MCP_TELEMETRY", property: "telemetry", value: "enabled" },
                { envVar: "MDB_MCP_LOG_PATH", property: "logPath", value: "/var/log" },
                { envVar: "MDB_MCP_CONNECTION_STRING", property: "connectionString", value: "mongodb://localhost" },
                { envVar: "MDB_MCP_READ_ONLY", property: "readOnly", value: true },
                { envVar: "MDB_MCP_INDEX_CHECK", property: "indexCheck", value: true },
                { envVar: "MDB_MCP_TRANSPORT", property: "transport", value: "http" },
                { envVar: "MDB_MCP_HTTP_PORT", property: "httpPort", value: 8080 },
                { envVar: "MDB_MCP_HTTP_HOST", property: "httpHost", value: "localhost" },
                { envVar: "MDB_MCP_IDLE_TIMEOUT_MS", property: "idleTimeoutMs", value: 5000 },
                { envVar: "MDB_MCP_NOTIFICATION_TIMEOUT_MS", property: "notificationTimeoutMs", value: 5000 },
                {
                    envVar: "MDB_MCP_ATLAS_TEMPORARY_DATABASE_USER_LIFETIME_MS",
                    property: "atlasTemporaryDatabaseUserLifetimeMs",
                    value: 12345,
                },
            ] as const;

            for (const { envVar, property, value } of testCases) {
                it(`should map ${envVar} to ${property} with value "${value}"`, () => {
                    const actual = setupUserConfig({
                        cli: [],
                        env: {
                            [envVar]: String(value),
                        },
                        defaults: defaultUserConfig,
                    });

                    expect(actual[property]).toBe(value);
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
                    const actual = setupUserConfig({
                        cli: [],
                        env: {
                            [envVar]: "disk,mcp",
                        },
                        defaults: defaultUserConfig,
                    });

                    expect(actual[config]).toEqual(["disk", "mcp"]);
                });
            }
        });
    });

    describe("cli parsing", () => {
        it("should not try to parse a multiple-host urls", () => {
            const actual = setupUserConfig({
                cli: ["myself", "--", "--connectionString", "mongodb://user:password@host1,host2,host3/"],
                env: {},
                defaults: defaultUserConfig,
            });

            expect(actual.connectionString).toEqual("mongodb://user:password@host1,host2,host3/");
        });

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
                    cli: ["--atlasTemporaryDatabaseUserLifetimeMs", "12345"],
                    expected: { atlasTemporaryDatabaseUserLifetimeMs: "12345" },
                },
                {
                    cli: ["--telemetry", "enabled"],
                    expected: { telemetry: "enabled" },
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
                        defaults: defaultUserConfig,
                    });

                    for (const [key, value] of Object.entries(expected)) {
                        expect(actual[key as keyof UserConfig]).toBe(value);
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
                    cli: ["--version"],
                    expected: { version: true },
                },
            ] as { cli: string[]; expected: Partial<UserConfig> }[];

            for (const { cli, expected } of testCases) {
                it(`should parse '${cli.join(" ")}' to ${JSON.stringify(expected)}`, () => {
                    const actual = setupUserConfig({
                        cli: ["myself", "--", ...cli],
                        env: {},
                        defaults: defaultUserConfig,
                    });

                    for (const [key, value] of Object.entries(expected)) {
                        expect(actual[key as keyof UserConfig]).toBe(value);
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
                    cli: ["--loggers", "disk,mcp"],
                    expected: { loggers: ["disk", "mcp"] },
                },
            ] as { cli: string[]; expected: Partial<UserConfig> }[];

            for (const { cli, expected } of testCases) {
                it(`should parse '${cli.join(" ")}' to ${JSON.stringify(expected)}`, () => {
                    const actual = setupUserConfig({
                        cli: ["myself", "--", ...cli],
                        env: {},
                        defaults: defaultUserConfig,
                    });

                    for (const [key, value] of Object.entries(expected)) {
                        expect(actual[key as keyof UserConfig]).toEqual(value);
                    }
                });
            }
        });
    });

    describe("precedence rules", () => {
        it("cli arguments take precedence over env vars", () => {
            const actual = setupUserConfig({
                cli: ["myself", "--", "--connectionString", "mongodb://localhost"],
                env: { MDB_MCP_CONNECTION_STRING: "mongodb://crazyhost" },
                defaults: defaultUserConfig,
            });

            expect(actual.connectionString).toBe("mongodb://localhost");
        });

        it("any cli argument takes precedence over defaults", () => {
            const actual = setupUserConfig({
                cli: ["myself", "--", "--connectionString", "mongodb://localhost"],
                env: {},
                defaults: {
                    ...defaultUserConfig,
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
                    ...defaultUserConfig,
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
                defaults: defaultUserConfig,
            });

            // the shell specifies directConnection=true and serverSelectionTimeoutMS=2000 by default
            expect(actual.connectionString).toBe(
                "mongodb://localhost/?directConnection=true&serverSelectionTimeoutMS=2000"
            );
            expect(actual.connectionSpecifier).toBe("mongodb://localhost");
        });
    });

    describe("validation", () => {
        describe("transport", () => {
            it("should support http", () => {
                const actual = setupUserConfig({
                    cli: ["myself", "--", "--transport", "http"],
                    env: {},
                    defaults: defaultUserConfig,
                });

                expect(actual.transport).toEqual("http");
            });

            it("should support stdio", () => {
                const actual = setupUserConfig({
                    cli: ["myself", "--", "--transport", "stdio"],
                    env: {},
                    defaults: defaultUserConfig,
                });

                expect(actual.transport).toEqual("stdio");
            });

            it("should not support sse", () => {
                expect(() =>
                    setupUserConfig({
                        cli: ["myself", "--", "--transport", "sse"],
                        env: {},
                        defaults: defaultUserConfig,
                    })
                ).toThrowError("Invalid transport: sse");
            });

            it("should not support arbitrary values", () => {
                const value = Math.random() + "transport";

                expect(() =>
                    setupUserConfig({
                        cli: ["myself", "--", "--transport", value],
                        env: {},
                        defaults: defaultUserConfig,
                    })
                ).toThrowError(`Invalid transport: ${value}`);
            });
        });

        describe("telemetry", () => {
            it("can be enabled", () => {
                const actual = setupUserConfig({
                    cli: ["myself", "--", "--telemetry", "enabled"],
                    env: {},
                    defaults: defaultUserConfig,
                });

                expect(actual.telemetry).toEqual("enabled");
            });

            it("can be disabled", () => {
                const actual = setupUserConfig({
                    cli: ["myself", "--", "--telemetry", "disabled"],
                    env: {},
                    defaults: defaultUserConfig,
                });

                expect(actual.telemetry).toEqual("disabled");
            });

            it("should not support the boolean true value", () => {
                expect(() =>
                    setupUserConfig({
                        cli: ["myself", "--", "--telemetry", "true"],
                        env: {},
                        defaults: defaultUserConfig,
                    })
                ).toThrowError("Invalid telemetry: true");
            });

            it("should not support the boolean false value", () => {
                expect(() =>
                    setupUserConfig({
                        cli: ["myself", "--", "--telemetry", "false"],
                        env: {},
                        defaults: defaultUserConfig,
                    })
                ).toThrowError("Invalid telemetry: false");
            });

            it("should not support arbitrary values", () => {
                const value = Math.random() + "telemetry";

                expect(() =>
                    setupUserConfig({
                        cli: ["myself", "--", "--telemetry", value],
                        env: {},
                        defaults: defaultUserConfig,
                    })
                ).toThrowError(`Invalid telemetry: ${value}`);
            });
        });

        describe("httpPort", () => {
            it("must be above 1", () => {
                expect(() =>
                    setupUserConfig({
                        cli: ["myself", "--", "--httpPort", "0"],
                        env: {},
                        defaults: defaultUserConfig,
                    })
                ).toThrowError("Invalid httpPort: 0");
            });

            it("must be below 65535 (OS limit)", () => {
                expect(() =>
                    setupUserConfig({
                        cli: ["myself", "--", "--httpPort", "89527345"],
                        env: {},
                        defaults: defaultUserConfig,
                    })
                ).toThrowError("Invalid httpPort: 89527345");
            });

            it("should not support non numeric values", () => {
                expect(() =>
                    setupUserConfig({
                        cli: ["myself", "--", "--httpPort", "portAventura"],
                        env: {},
                        defaults: defaultUserConfig,
                    })
                ).toThrowError("Invalid httpPort: portAventura");
            });

            it("should support numeric values", () => {
                const actual = setupUserConfig({
                    cli: ["myself", "--", "--httpPort", "8888"],
                    env: {},
                    defaults: defaultUserConfig,
                });

                expect(actual.httpPort).toEqual("8888");
            });
        });

        describe("loggers", () => {
            it("must not be empty", () => {
                expect(() =>
                    setupUserConfig({
                        cli: ["myself", "--", "--loggers", ""],
                        env: {},
                        defaults: defaultUserConfig,
                    })
                ).toThrowError("No loggers found in config");
            });

            it("must not allow duplicates", () => {
                expect(() =>
                    setupUserConfig({
                        cli: ["myself", "--", "--loggers", "disk,disk,disk"],
                        env: {},
                        defaults: defaultUserConfig,
                    })
                ).toThrowError("Duplicate loggers found in config");
            });

            it("allows mcp logger", () => {
                const actual = setupUserConfig({
                    cli: ["myself", "--", "--loggers", "mcp"],
                    env: {},
                    defaults: defaultUserConfig,
                });

                expect(actual.loggers).toEqual(["mcp"]);
            });

            it("allows disk logger", () => {
                const actual = setupUserConfig({
                    cli: ["myself", "--", "--loggers", "disk"],
                    env: {},
                    defaults: defaultUserConfig,
                });

                expect(actual.loggers).toEqual(["disk"]);
            });

            it("allows stderr logger", () => {
                const actual = setupUserConfig({
                    cli: ["myself", "--", "--loggers", "stderr"],
                    env: {},
                    defaults: defaultUserConfig,
                });

                expect(actual.loggers).toEqual(["stderr"]);
            });
        });
    });
});

describe("CLI arguments", () => {
    const referDocMessage =
        "Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server.";

    type TestCase = { readonly cliArg: keyof (CliOptions & UserConfig); readonly warning: string };
    const testCases = [
        {
            cliArg: "connectionString",
            warning:
                "The --connectionString argument is deprecated. Prefer using the first positional argument for the connection string or the MDB_MCP_CONNECTION_STRING environment variable.",
        },
    ] as TestCase[];

    for (const { cliArg, warning } of testCases) {
        describe(`deprecation behaviour of ${cliArg}`, () => {
            let cliArgs: CliOptions & UserConfig & { _?: string[] };
            let warn: (msg: string) => void;
            let exit: (status: number) => void | never;

            beforeEach(() => {
                cliArgs = { [cliArg]: "RandomString" } as unknown as CliOptions & UserConfig & { _?: string[] };
                warn = vi.fn();
                exit = vi.fn();

                warnAboutDeprecatedOrUnknownCliArgs(cliArgs as unknown as Record<string, unknown>, { warn, exit });
            });

            it(`warns the usage of ${cliArg} as it is deprecated`, () => {
                expect(warn).toHaveBeenCalledWith(warning);
            });

            it(`shows the reference message when ${cliArg} was passed`, () => {
                expect(warn).toHaveBeenCalledWith(referDocMessage);
            });

            it(`should not exit the process`, () => {
                expect(exit).not.toHaveBeenCalled();
            });
        });
    }

    describe("invalid arguments", () => {
        let warn: (msg: string) => void;
        let exit: (status: number) => void | never;

        beforeEach(() => {
            warn = vi.fn();
            exit = vi.fn();
        });

        it("should show a warning when an argument is not known", () => {
            warnAboutDeprecatedOrUnknownCliArgs(
                {
                    wakanda: "",
                },
                { warn, exit }
            );

            expect(warn).toHaveBeenCalledWith("Invalid command line argument 'wakanda'.");
            expect(warn).toHaveBeenCalledWith(
                "Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server."
            );
        });

        it("should exit the process on unknown cli args", () => {
            warnAboutDeprecatedOrUnknownCliArgs(
                {
                    wakanda: "",
                },
                { warn, exit }
            );

            expect(exit).toHaveBeenCalledWith(1);
        });

        it("should show a suggestion when is a simple typo", () => {
            warnAboutDeprecatedOrUnknownCliArgs(
                {
                    readonli: "",
                },
                { warn, exit }
            );

            expect(warn).toHaveBeenCalledWith("Invalid command line argument 'readonli'. Did you mean 'readOnly'?");
            expect(warn).toHaveBeenCalledWith(
                "Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server."
            );
        });

        it("should show a suggestion when the only change is on the case", () => {
            warnAboutDeprecatedOrUnknownCliArgs(
                {
                    readonly: "",
                },
                { warn, exit }
            );

            expect(warn).toHaveBeenCalledWith("Invalid command line argument 'readonly'. Did you mean 'readOnly'?");
            expect(warn).toHaveBeenCalledWith(
                "Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server."
            );
        });
    });

    describe("keychain management", () => {
        type TestCase = { readonly cliArg: keyof UserConfig; secretKind: Secret["kind"] };
        const testCases = [
            { cliArg: "apiClientId", secretKind: "user" },
            { cliArg: "apiClientSecret", secretKind: "password" },
            { cliArg: "awsAccessKeyId", secretKind: "password" },
            { cliArg: "awsIamSessionToken", secretKind: "password" },
            { cliArg: "awsSecretAccessKey", secretKind: "password" },
            { cliArg: "awsSessionToken", secretKind: "password" },
            { cliArg: "password", secretKind: "password" },
            { cliArg: "tlsCAFile", secretKind: "url" },
            { cliArg: "tlsCRLFile", secretKind: "url" },
            { cliArg: "tlsCertificateKeyFile", secretKind: "url" },
            { cliArg: "tlsCertificateKeyFilePassword", secretKind: "password" },
            { cliArg: "username", secretKind: "user" },
        ] as TestCase[];
        let keychain: Keychain;

        beforeEach(() => {
            keychain = Keychain.root;
            keychain.clearAllSecrets();
        });

        afterEach(() => {
            keychain.clearAllSecrets();
        });

        for (const { cliArg, secretKind } of testCases) {
            it(`should register ${cliArg} as a secret of kind ${secretKind} in the root keychain`, () => {
                registerKnownSecretsInRootKeychain({ [cliArg]: cliArg });

                expect(keychain.allSecrets).toEqual([{ value: cliArg, kind: secretKind }]);
            });
        }
    });
});
