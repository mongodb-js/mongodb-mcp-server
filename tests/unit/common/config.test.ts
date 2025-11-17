import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from "vitest";
import { type UserConfig, UserConfigSchema } from "../../../src/common/config/userConfig.js";
import { type CreateUserConfigHelpers, createUserConfig } from "../../../src/common/config/createUserConfig.js";
import { getLogPath, getExportsPath } from "../../../src/common/config/configUtils.js";
import { Keychain } from "../../../src/common/keychain.js";
import type { Secret } from "../../../src/common/keychain.js";

function createEnvironment(): {
    setVariable: (this: void, variable: string, value: unknown) => void;
    clearVariables(this: void): void;
} {
    const registeredEnvVariables: string[] = [];

    return {
        setVariable(variable: string, value: unknown): void {
            (process.env as Record<string, unknown>)[variable] = value;
            registeredEnvVariables.push(variable);
        },

        clearVariables(): void {
            for (const variable of registeredEnvVariables) {
                delete (process.env as Record<string, unknown>)[variable];
            }
        },
    };
}

describe("config", () => {
    it("should generate defaults from UserConfigSchema that match expected values", () => {
        // Expected hardcoded values (what we had before)
        const expectedDefaults = {
            apiBaseUrl: "https://cloud.mongodb.com/",
            logPath: getLogPath(),
            exportsPath: getExportsPath(),
            exportTimeoutMs: 5 * 60 * 1000, // 5 minutes
            exportCleanupIntervalMs: 2 * 60 * 1000, // 2 minutes
            disabledTools: [],
            telemetry: "enabled",
            readOnly: false,
            indexCheck: false,
            confirmationRequiredTools: [
                "atlas-create-access-list",
                "atlas-create-db-user",
                "drop-database",
                "drop-collection",
                "delete-many",
                "drop-index",
            ],
            transport: "stdio",
            httpPort: 3000,
            httpHost: "127.0.0.1",
            loggers: ["disk", "mcp"],
            idleTimeoutMs: 10 * 60 * 1000, // 10 minutes
            notificationTimeoutMs: 9 * 60 * 1000, // 9 minutes
            httpHeaders: {},
            maxDocumentsPerQuery: 100,
            maxBytesPerQuery: 16 * 1024 * 1024, // ~16 mb
            atlasTemporaryDatabaseUserLifetimeMs: 4 * 60 * 60 * 1000, // 4 hours
            voyageApiKey: "",
            vectorSearchDimensions: 1024,
            vectorSearchSimilarityFunction: "euclidean",
            disableEmbeddingsValidation: false,
            previewFeatures: [],
        };
        expect(UserConfigSchema.parse({})).toStrictEqual(expectedDefaults);
    });

    it("should generate defaults when no config sources are populated", () => {
        const expectedDefaults = {
            apiBaseUrl: "https://cloud.mongodb.com/",
            logPath: getLogPath(),
            exportsPath: getExportsPath(),
            exportTimeoutMs: 5 * 60 * 1000, // 5 minutes
            exportCleanupIntervalMs: 2 * 60 * 1000, // 2 minutes
            disabledTools: [],
            telemetry: "enabled",
            readOnly: false,
            indexCheck: false,
            confirmationRequiredTools: [
                "atlas-create-access-list",
                "atlas-create-db-user",
                "drop-database",
                "drop-collection",
                "delete-many",
                "drop-index",
            ],
            transport: "stdio",
            httpPort: 3000,
            httpHost: "127.0.0.1",
            loggers: ["disk", "mcp"],
            idleTimeoutMs: 10 * 60 * 1000, // 10 minutes
            notificationTimeoutMs: 9 * 60 * 1000, // 9 minutes
            httpHeaders: {},
            maxDocumentsPerQuery: 100,
            maxBytesPerQuery: 16 * 1024 * 1024, // ~16 mb
            atlasTemporaryDatabaseUserLifetimeMs: 4 * 60 * 60 * 1000, // 4 hours
            voyageApiKey: "",
            vectorSearchDimensions: 1024,
            vectorSearchSimilarityFunction: "euclidean",
            disableEmbeddingsValidation: false,
            previewFeatures: [],
        };
        expect(createUserConfig()).toStrictEqual(expectedDefaults);
    });

    describe("env var parsing", () => {
        const { setVariable, clearVariables } = createEnvironment();

        afterEach(() => {
            clearVariables();
        });

        describe("mongodb urls", () => {
            it("should not try to parse a multiple-host urls", () => {
                setVariable("MDB_MCP_CONNECTION_STRING", "mongodb://user:password@host1,host2,host3/");
                const actual = createUserConfig();
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
                    setVariable(envVar, value);
                    const actual = createUserConfig();
                    expect(actual[property]).toBe(value);
                });
            }
        });

        describe("array cases", () => {
            const testCases = [
                { envVar: "MDB_MCP_DISABLED_TOOLS", property: "disabledTools", value: "find,export" },
                { envVar: "MDB_MCP_LOGGERS", property: "loggers", value: "disk,mcp" },
            ] as const;

            for (const { envVar, property, value } of testCases) {
                it(`should map ${envVar} to ${property}`, () => {
                    setVariable(envVar, value);
                    const actual = createUserConfig();
                    expect(actual[property]).toEqual(value.split(","));
                });
            }
        });
    });

    describe("cli parsing", () => {
        it("should not try to parse a multiple-host urls", () => {
            const actual = createUserConfig({
                cliArguments: ["--connectionString", "mongodb://user:password@host1,host2,host3/"],
            });

            expect(actual.connectionString).toEqual("mongodb://user:password@host1,host2,host3/");
        });

        it("positional connection specifier gets accounted for even without other connection sources", () => {
            // Note that neither connectionString argument nor env variable is
            // provided.
            const actual = createUserConfig({
                cliArguments: ["mongodb://host1:27017"],
            });
            expect(actual.connectionString).toEqual("mongodb://host1:27017/?directConnection=true");
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
                    expected: { httpPort: 8080 },
                },
                {
                    cli: ["--idleTimeoutMs", "42"],
                    expected: { idleTimeoutMs: 42 },
                },
                {
                    cli: ["--logPath", "/var/"],
                    expected: { logPath: "/var/" },
                },
                {
                    cli: ["--notificationTimeoutMs", "42"],
                    expected: { notificationTimeoutMs: 42 },
                },
                {
                    cli: ["--atlasTemporaryDatabaseUserLifetimeMs", "12345"],
                    expected: { atlasTemporaryDatabaseUserLifetimeMs: 12345 },
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
                    expected: { oidcRedirectUri: "https://oidc", oidcRedirectUrl: "https://oidc" },
                },
                {
                    cli: ["--oidcRedirectUrl", "https://oidc"],
                    expected: { oidcRedirectUrl: "https://oidc", oidcRedirectUri: "https://oidc" },
                },
                {
                    cli: ["--password", "123456"],
                    expected: { password: "123456", p: "123456" },
                },
                {
                    cli: ["-p", "123456"],
                    expected: { password: "123456", p: "123456" },
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
                    expected: { username: "admin", u: "admin" },
                },
                {
                    cli: ["-u", "admin"],
                    expected: { username: "admin", u: "admin" },
                },
            ] as { cli: string[]; expected: Partial<UserConfig> }[];

            for (const { cli, expected } of testCases) {
                it(`should parse '${cli.join(" ")}' to ${JSON.stringify(expected)}`, () => {
                    const actual = createUserConfig({
                        cliArguments: cli,
                    });
                    expect(actual).toStrictEqual({
                        ...UserConfigSchema.parse({}),
                        ...expected,
                    });
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
                    const actual = createUserConfig({
                        cliArguments: cli,
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
                    const actual = createUserConfig({
                        cliArguments: cli,
                    });
                    for (const [key, value] of Object.entries(expected)) {
                        expect(actual[key as keyof UserConfig]).toEqual(value);
                    }
                });
            }
        });
    });

    describe("precedence rules", () => {
        const { setVariable, clearVariables } = createEnvironment();

        afterEach(() => {
            clearVariables();
        });

        it("positional argument takes precedence over all", () => {
            setVariable("MDB_MCP_CONNECTION_STRING", "mongodb://crazyhost1");
            const actual = createUserConfig({
                cliArguments: ["mongodb://crazyhost2", "--connectionString", "mongodb://localhost"],
            });
            expect(actual.connectionString).toBe("mongodb://crazyhost2/?directConnection=true");
        });

        it("cli arguments take precedence over env vars", () => {
            setVariable("MDB_MCP_CONNECTION_STRING", "mongodb://crazyhost");
            const actual = createUserConfig({
                cliArguments: ["--connectionString", "mongodb://localhost"],
            });
            expect(actual.connectionString).toBe("mongodb://localhost");
        });

        it("any cli argument takes precedence over defaults", () => {
            const actual = createUserConfig({
                cliArguments: ["--connectionString", "mongodb://localhost"],
            });
            expect(actual.connectionString).toBe("mongodb://localhost");
        });

        it("any env var takes precedence over defaults", () => {
            setVariable("MDB_MCP_CONNECTION_STRING", "mongodb://localhost");
            const actual = createUserConfig();
            expect(actual.connectionString).toBe("mongodb://localhost");
        });
    });

    describe("consolidation", () => {
        it("positional argument for url has precedence over --connectionString", () => {
            const actual = createUserConfig({
                cliArguments: ["mongodb://localhost", "--connectionString", "mongodb://toRemoveHost"],
            });
            // the shell specifies directConnection=true and serverSelectionTimeoutMS=2000 by default
            expect(actual.connectionString).toBe(
                "mongodb://localhost/?directConnection=true&serverSelectionTimeoutMS=2000"
            );
        });

        it("positional argument is always considered", () => {
            const actual = createUserConfig({
                cliArguments: ["mongodb://localhost"],
            });
            // the shell specifies directConnection=true and serverSelectionTimeoutMS=2000 by default
            expect(actual.connectionString).toBe(
                "mongodb://localhost/?directConnection=true&serverSelectionTimeoutMS=2000"
            );
        });
    });

    describe("validation", () => {
        describe("transport", () => {
            it("should support http", () => {
                const actual = createUserConfig({
                    cliArguments: ["--transport", "http"],
                });
                expect(actual.transport).toEqual("http");
            });

            it("should support stdio", () => {
                const actual = createUserConfig({
                    cliArguments: ["--transport", "stdio"],
                });
                expect(actual.transport).toEqual("stdio");
            });

            it("should not support sse", () => {
                const onErrorFn = vi.fn();
                const onExitFn = vi.fn<CreateUserConfigHelpers["closeProcess"]>();
                createUserConfig({
                    onError: onErrorFn,
                    closeProcess: onExitFn,
                    cliArguments: ["--transport", "sse"],
                });
                expect(onErrorFn).toBeCalledWith(
                    expect.stringContaining(
                        'Invalid configuration for the following fields:\ntransport - Invalid option: expected one of "stdio"|"http"'
                    )
                );
                expect(onExitFn).toBeCalledWith(1);
            });

            it("should not support arbitrary values", () => {
                const value = Math.random() + "transport";
                const onErrorFn = vi.fn();
                const onExitFn = vi.fn<CreateUserConfigHelpers["closeProcess"]>();
                createUserConfig({
                    onError: onErrorFn,
                    closeProcess: onExitFn,
                    cliArguments: ["--transport", value],
                });
                expect(onErrorFn).toBeCalledWith(
                    expect.stringContaining(
                        'Invalid configuration for the following fields:\ntransport - Invalid option: expected one of "stdio"|"http"'
                    )
                );
                expect(onExitFn).toBeCalledWith(1);
            });
        });

        describe("telemetry", () => {
            it("can be enabled", () => {
                const actual = createUserConfig({
                    cliArguments: ["--telemetry", "enabled"],
                });
                expect(actual.telemetry).toEqual("enabled");
            });

            it("can be disabled", () => {
                const actual = createUserConfig({
                    cliArguments: ["--telemetry", "disabled"],
                });
                expect(actual.telemetry).toEqual("disabled");
            });

            it("should not support the boolean true value", () => {
                const onErrorFn = vi.fn();
                const onExitFn = vi.fn<CreateUserConfigHelpers["closeProcess"]>();
                createUserConfig({
                    onError: onErrorFn,
                    closeProcess: onExitFn,
                    cliArguments: ["--telemetry", "true"],
                });
                expect(onErrorFn).toBeCalledWith(
                    expect.stringContaining(
                        'Invalid configuration for the following fields:\ntelemetry - Invalid option: expected one of "enabled"|"disabled"'
                    )
                );
                expect(onExitFn).toBeCalledWith(1);
            });

            it("should not support the boolean false value", () => {
                const onErrorFn = vi.fn();
                const onExitFn = vi.fn<CreateUserConfigHelpers["closeProcess"]>();
                createUserConfig({
                    onError: onErrorFn,
                    closeProcess: onExitFn,
                    cliArguments: ["--telemetry", "false"],
                });
                expect(onErrorFn).toBeCalledWith(
                    expect.stringContaining(
                        'Invalid configuration for the following fields:\ntelemetry - Invalid option: expected one of "enabled"|"disabled"'
                    )
                );
                expect(onExitFn).toBeCalledWith(1);
            });

            it("should not support arbitrary values", () => {
                const value = Math.random() + "telemetry";
                const onErrorFn = vi.fn();
                const onExitFn = vi.fn<CreateUserConfigHelpers["closeProcess"]>();
                createUserConfig({
                    onError: onErrorFn,
                    closeProcess: onExitFn,
                    cliArguments: ["--telemetry", value],
                });
                expect(onErrorFn).toBeCalledWith(
                    expect.stringContaining(
                        'Invalid configuration for the following fields:\ntelemetry - Invalid option: expected one of "enabled"|"disabled"'
                    )
                );
                expect(onExitFn).toBeCalledWith(1);
            });
        });

        describe("httpPort", () => {
            it("must be above 1", () => {
                const onErrorFn = vi.fn();
                const onExitFn = vi.fn<CreateUserConfigHelpers["closeProcess"]>();
                createUserConfig({
                    onError: onErrorFn,
                    closeProcess: onExitFn,
                    cliArguments: ["--httpPort", "0"],
                });
                expect(onErrorFn).toBeCalledWith(
                    expect.stringContaining(
                        "Invalid configuration for the following fields:\nhttpPort - Invalid httpPort: must be at least 1"
                    )
                );
                expect(onExitFn).toBeCalledWith(1);
            });

            it("must be below 65535 (OS limit)", () => {
                const onErrorFn = vi.fn();
                const onExitFn = vi.fn<CreateUserConfigHelpers["closeProcess"]>();
                createUserConfig({
                    onError: onErrorFn,
                    closeProcess: onExitFn,
                    cliArguments: ["--httpPort", "89527345"],
                });
                expect(onErrorFn).toBeCalledWith(
                    expect.stringContaining(
                        "Invalid configuration for the following fields:\nhttpPort - Invalid httpPort: must be at most 65535"
                    )
                );
                expect(onExitFn).toBeCalledWith(1);
            });

            it("should not support non numeric values", () => {
                const onErrorFn = vi.fn();
                const onExitFn = vi.fn<CreateUserConfigHelpers["closeProcess"]>();
                createUserConfig({
                    onError: onErrorFn,
                    closeProcess: onExitFn,
                    cliArguments: ["--httpPort", "portAventura"],
                });
                expect(onErrorFn).toBeCalledWith(
                    expect.stringContaining(
                        "Invalid configuration for the following fields:\nhttpPort - Invalid input: expected number, received NaN"
                    )
                );
                expect(onExitFn).toBeCalledWith(1);
            });

            it("should support numeric values", () => {
                const actual = createUserConfig({ cliArguments: ["--httpPort", "8888"] });
                expect(actual.httpPort).toEqual(8888);
            });
        });

        describe("loggers", () => {
            it("must not be empty", () => {
                const onErrorFn = vi.fn();
                const onExitFn = vi.fn<CreateUserConfigHelpers["closeProcess"]>();
                createUserConfig({
                    onError: onErrorFn,
                    closeProcess: onExitFn,
                    cliArguments: ["--loggers", ""],
                });
                expect(onErrorFn).toBeCalledWith(
                    expect.stringContaining(
                        "Invalid configuration for the following fields:\nloggers - Cannot be an empty array"
                    )
                );
                expect(onExitFn).toBeCalledWith(1);
            });

            it("must not allow duplicates", () => {
                const onErrorFn = vi.fn();
                const onExitFn = vi.fn<CreateUserConfigHelpers["closeProcess"]>();
                createUserConfig({
                    onError: onErrorFn,
                    closeProcess: onExitFn,
                    cliArguments: ["--loggers", "disk,disk,disk"],
                });
                expect(onErrorFn).toBeCalledWith(
                    expect.stringContaining(
                        "Invalid configuration for the following fields:\nloggers - Duplicate loggers found in config"
                    )
                );
                expect(onExitFn).toBeCalledWith(1);
            });

            it("allows mcp logger", () => {
                const actual = createUserConfig({ cliArguments: ["--loggers", "mcp"] });
                expect(actual.loggers).toEqual(["mcp"]);
            });

            it("allows disk logger", () => {
                const actual = createUserConfig({ cliArguments: ["--loggers", "disk"] });
                expect(actual.loggers).toEqual(["disk"]);
            });

            it("allows stderr logger", () => {
                const actual = createUserConfig({ cliArguments: ["--loggers", "stderr"] });
                expect(actual.loggers).toEqual(["stderr"]);
            });
        });
    });
});

describe("Warning and Error messages", () => {
    let warn: MockedFunction<CreateUserConfigHelpers["onWarning"]>;
    let error: MockedFunction<CreateUserConfigHelpers["onError"]>;
    let exit: MockedFunction<CreateUserConfigHelpers["closeProcess"]>;
    const referDocMessage =
        "- Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server.";

    beforeEach(() => {
        warn = vi.fn();
        error = vi.fn();
        exit = vi.fn();
    });

    describe("Deprecated CLI arguments", () => {
        const testCases = [
            {
                cliArg: "--connectionString",
                value: "mongodb://localhost:27017",
                warning:
                    "Warning: The --connectionString argument is deprecated. Prefer using the MDB_MCP_CONNECTION_STRING environment variable or the first positional argument for the connection string.",
            },
        ] as const;

        for (const { cliArg, value, warning } of testCases) {
            describe(`deprecation behaviour of ${cliArg}`, () => {
                beforeEach(() => {
                    createUserConfig({ onWarning: warn, closeProcess: exit, cliArguments: [cliArg, value] });
                });

                it(`warns the usage of ${cliArg} as it is deprecated`, () => {
                    expect(warn).toHaveBeenCalledWith(expect.stringContaining(warning));
                });

                it(`shows the reference message when ${cliArg} was passed`, () => {
                    expect(warn).toHaveBeenCalledWith(expect.stringContaining(referDocMessage));
                });

                it(`should not exit the process`, () => {
                    expect(exit).not.toHaveBeenCalled();
                });
            });
        }
    });

    describe("invalid arguments", () => {
        it("should show an error when an argument is not known and exit the process", () => {
            createUserConfig({
                cliArguments: ["--wakanda", "forever"],
                onWarning: warn,
                onError: error,
                closeProcess: exit,
            });

            expect(error).toHaveBeenCalledWith(
                expect.stringContaining("Error: Invalid command line argument '--wakanda'.")
            );
            expect(error).toHaveBeenCalledWith(
                expect.stringContaining(
                    "- Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server."
                )
            );
            expect(exit).toHaveBeenCalledWith(1);
        });

        it("should show a suggestion when is a simple typo", () => {
            createUserConfig({
                cliArguments: ["--readonli", ""],
                onWarning: warn,
                onError: error,
                closeProcess: exit,
            });
            expect(error).toHaveBeenCalledWith(
                expect.stringContaining("Error: Invalid command line argument '--readonli'. Did you mean '--readOnly'?")
            );
            expect(error).toHaveBeenCalledWith(
                expect.stringContaining(
                    "- Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server."
                )
            );
            expect(exit).toHaveBeenCalledWith(1);
        });

        it("should show a suggestion when the only change is on the case", () => {
            createUserConfig({
                cliArguments: ["--readonly", ""],
                onWarning: warn,
                onError: error,
                closeProcess: exit,
            });

            expect(error).toHaveBeenCalledWith(
                expect.stringContaining("Error: Invalid command line argument '--readonly'. Did you mean '--readOnly'?")
            );
            expect(error).toHaveBeenCalledWith(
                expect.stringContaining(
                    "- Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server."
                )
            );
            expect(exit).toHaveBeenCalledWith(1);
        });
    });

    describe("vector search misconfiguration", () => {
        it("should warn if vectorSearch is enabled but embeddings provider is not configured", () => {
            createUserConfig({
                cliArguments: ["--previewFeatures", "vectorSearch"],
                onWarning: warn,
                onError: error,
                closeProcess: exit,
            });
            expect(warn).toBeCalledWith(`\
Warning: Vector search is enabled but no embeddings provider is configured.
- Set an embeddings provider configuration option to enable auto-embeddings during document insertion and text-based queries with $vectorSearch.\
`);
        });

        it("should warn if vectorSearch is not enabled but embeddings provider is configured", () => {
            createUserConfig({
                cliArguments: ["--voyageApiKey", "1FOO"],
                onWarning: warn,
                onError: error,
                closeProcess: exit,
            });

            expect(warn).toBeCalledWith(`\
Warning: An embeddings provider is configured but the 'vectorSearch' preview feature is not enabled.
- Enable vector search by adding 'vectorSearch' to the 'previewFeatures' configuration option, or remove the embeddings provider configuration if not needed.\
`);
        });

        it("should not warn if vectorSearch is enabled correctly", () => {
            createUserConfig({
                cliArguments: ["--voyageApiKey", "1FOO", "--previewFeatures", "vectorSearch"],
                onWarning: warn,
                onError: error,
                closeProcess: exit,
            });
            expect(warn).not.toBeCalled();
        });
    });
});

describe("keychain management", () => {
    type TestCase = { readonly cliArg: keyof UserConfig; secretKind: Secret["kind"] };
    const testCases = [
        { cliArg: "apiClientId", secretKind: "user" },
        { cliArg: "apiClientSecret", secretKind: "password" },
        /*
         * Note: These arguments were part of original test cases before
         * refactor of Config but because now we use yargs-parser to strictly
         * parse the config and do not allow unknown arguments to creep into the
         * final results, these arguments never end up in the config. It is
         * because we have the mongosh OPTIONS copied over from the repo and the
         * copied object does not contain these as parse targets.
         *
         * TODO: Whenever we finish importing OPTIONS from mongosh these test
         * cases should be good to be enabled again.
         */
        // { cliArg: "awsAccessKeyId", secretKind: "password" },
        // { cliArg: "awsIamSessionToken", secretKind: "password" },
        // { cliArg: "awsSecretAccessKey", secretKind: "password" },
        // { cliArg: "awsSessionToken", secretKind: "password" },
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
            createUserConfig({ cliArguments: [`--${cliArg}`, cliArg], onError: console.error });
            expect(keychain.allSecrets).toEqual([{ value: cliArg, kind: secretKind }]);
        });
    }
});
