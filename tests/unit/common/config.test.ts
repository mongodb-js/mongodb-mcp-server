import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type UserConfig, UserConfigSchema } from "../../../src/common/config/userConfig.js";
import { parseUserConfig, defaultParserOptions } from "../../../src/common/config/parseUserConfig.js";
import {
    getLogPath,
    getExportsPath,
    onlyLowerThanBaseValueOverride,
    onlySubsetOfBaseValueOverride,
} from "../../../src/common/config/configUtils.js";
import { Keychain } from "../../../src/common/keychain.js";
import type { Secret } from "../../../src/common/keychain.js";
import { createEnvironment } from "../../utils/index.js";
import path from "path";
import { TRANSPORT_PAYLOAD_LIMITS } from "../../../src/transports/constants.js";
import { getConfigMeta } from "../../../src/common/config/configOverrides.js";

// Expected hardcoded values (what we had before)
const expectedDefaults = {
    apiBaseUrl: "https://cloud.mongodb.com/",
    assistantBaseUrl: "https://knowledge.mongodb.com/api/v1/",
    logPath: getLogPath(),
    exportsPath: getExportsPath(),
    exportTimeoutMs: 5 * 60 * 1000, // 5 minutes
    exportCleanupIntervalMs: 2 * 60 * 1000, // 2 minutes
    disabledTools: [],
    telemetry: "enabled",
    readOnly: false,
    indexCheck: false,
    deepInspect: true,
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
    httpBodyLimit: TRANSPORT_PAYLOAD_LIMITS.http,
    maxDocumentsPerQuery: 100,
    maxBytesPerQuery: 16 * 1024 * 1024, // ~16 mb
    atlasTemporaryDatabaseUserLifetimeMs: 4 * 60 * 60 * 1000, // 4 hours
    voyageApiKey: "",
    vectorSearchDimensions: 1024,
    vectorSearchSimilarityFunction: "euclidean",
    embeddingsValidation: true,
    previewFeatures: [],
    dryRun: false,
    allowRequestOverrides: false,
    externallyManagedSessions: false,
    httpResponseType: "sse",
};

const CONFIG_FIXTURES = {
    VALID: path.resolve(import.meta.dirname, "..", "..", "fixtures", "valid-config.json"),
    WITH_INVALID_VALUE: path.resolve(import.meta.dirname, "..", "..", "fixtures", "config-with-invalid-value.json"),
};

describe("config", () => {
    it("should generate defaults from UserConfigSchema that match expected values", () => {
        expect(UserConfigSchema.parse({})).toStrictEqual(expectedDefaults);
    });

    it("should generate defaults when no config sources are populated", () => {
        expect(parseUserConfig({ args: [] })).toStrictEqual({
            parsed: expectedDefaults,
            warnings: [],
            error: undefined,
        });
    });

    it("can override defaults in the schema and those are populated instead", () => {
        expect(
            parseUserConfig({
                args: [],
                overrides: {
                    exportTimeoutMs: UserConfigSchema.shape.exportTimeoutMs.default(123),
                },
            })
        ).toStrictEqual({
            parsed: {
                ...expectedDefaults,
                exportTimeoutMs: 123,
            },
            warnings: [],
            error: undefined,
        });
    });

    describe("env var parsing", () => {
        const { setVariable, clearVariables } = createEnvironment();

        afterEach(() => {
            clearVariables();
        });

        describe("mongodb urls", () => {
            it("should not try to parse a multiple-host urls", () => {
                setVariable("MDB_MCP_CONNECTION_STRING", "mongodb://user:password@host1,host2,host3/");
                const { parsed: actual } = parseUserConfig({ args: [] });
                expect(actual?.connectionString).toEqual("mongodb://user:password@host1,host2,host3/");
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
                { envVar: "MDB_MCP_READ_ONLY", property: "readOnly", value: false },
                { envVar: "MDB_MCP_READ_ONLY", property: "readOnly", value: "", expectedValue: false },
                { envVar: "MDB_MCP_READ_ONLY", property: "readOnly", value: "false", expectedValue: false },
                { envVar: "MDB_MCP_READ_ONLY", property: "readOnly", value: "true", expectedValue: true },
                { envVar: "MDB_MCP_READ_ONLY", property: "readOnly", value: "apple", expectedValue: false },
                { envVar: "MDB_MCP_READ_ONLY", property: "readOnly", value: "FALSE", expectedValue: false },
                { envVar: "MDB_MCP_READ_ONLY", property: "readOnly", value: 0, expectedValue: false },
                { envVar: "MDB_MCP_READ_ONLY", property: "readOnly", value: 1, expectedValue: false },
                { envVar: "MDB_MCP_READ_ONLY", property: "readOnly", value: 100, expectedValue: false },
                { envVar: "MDB_MCP_INDEX_CHECK", property: "indexCheck", value: true },
                { envVar: "MDB_MCP_TRANSPORT", property: "transport", value: "http" },
                { envVar: "MDB_MCP_HTTP_PORT", property: "httpPort", value: 8080 },
                { envVar: "MDB_MCP_HTTP_HOST", property: "httpHost", value: "localhost" },
                { envVar: "MDB_MCP_HTTP_BODY_LIMIT", property: "httpBodyLimit", value: 10 * 1024 * 1024 },
                { envVar: "MDB_MCP_IDLE_TIMEOUT_MS", property: "idleTimeoutMs", value: 5000 },
                { envVar: "MDB_MCP_NOTIFICATION_TIMEOUT_MS", property: "notificationTimeoutMs", value: 5000 },
                {
                    envVar: "MDB_MCP_ATLAS_TEMPORARY_DATABASE_USER_LIFETIME_MS",
                    property: "atlasTemporaryDatabaseUserLifetimeMs",
                    value: 12345,
                },
            ] as {
                envVar: string;
                property: keyof UserConfig;
                value: unknown;
                expectedValue?: unknown;
            }[];

            for (const { envVar, property, value, expectedValue } of testCases) {
                it(`should map ${envVar} to ${property} with value "${String(value)}" to "${String(expectedValue ?? value)}"`, () => {
                    setVariable(envVar, value);
                    const { parsed: actual } = parseUserConfig({ args: [] });
                    expect(actual?.[property]).toBe(expectedValue ?? value);
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
                    const { parsed: actual } = parseUserConfig({ args: [] });
                    expect(actual?.[property]).toEqual(value.split(","));
                });
            }
        });

        it("works with custom prefixes through parserOptions", () => {
            setVariable("CUSTOM_MCP_DISABLED_TOOLS", "find,export");
            // Ensure our own ENV doesn't affect it
            setVariable("MDB_MCP_DISABLED_TOOLS", "explain");
            const { parsed: actual } = parseUserConfig({
                args: [],
                parserOptions: {
                    ...defaultParserOptions,
                    envPrefix: "CUSTOM_MCP_",
                },
            });
            expect(actual?.disabledTools).toEqual(["find", "export"]);
        });
    });

    describe("cli parsing", () => {
        it("should not try to parse a multiple-host urls", () => {
            const { parsed: actual } = parseUserConfig({
                args: ["--connectionString", "mongodb://user:password@host1,host2,host3/"],
            });

            expect(actual?.connectionString).toEqual("mongodb://user:password@host1,host2,host3/");
        });

        it("positional connection specifier gets accounted for even without other connection sources", () => {
            // Note that neither connectionString argument nor env variable is
            // provided.
            const { parsed: actual } = parseUserConfig({
                args: ["mongodb://host1:27017"],
            });
            expect(actual?.connectionString).toEqual("mongodb://host1:27017/?directConnection=true");
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
                    cli: ["--httpBodyLimit", "52428800"],
                    expected: { httpBodyLimit: 50 * 1024 * 1024 },
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
                    expected: { tlsCAFile: "/var/file" },
                },
                {
                    cli: ["--sslCRLFile", "/var/file"],
                    expected: { tlsCRLFile: "/var/file" },
                },
                {
                    cli: ["--sslCertificateSelector", "pem=pom"],
                    expected: { tlsCertificateSelector: "pem=pom" },
                },
                {
                    cli: ["--sslDisabledProtocols", "tls1"],
                    expected: { tlsDisabledProtocols: "tls1" },
                },
                {
                    cli: ["--sslPEMKeyFile", "/var/pem"],
                    expected: { tlsCertificateKeyFile: "/var/pem" },
                },
                {
                    cli: ["--sslPEMKeyPassword", "654321"],
                    expected: { tlsCertificateKeyFilePassword: "654321" },
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
                    const { parsed, error } = parseUserConfig({
                        args: cli,
                    });
                    expect(error).toBeUndefined();
                    expect(parsed).toStrictEqual({
                        ...UserConfigSchema.parse({}),
                        ...expected,
                    });
                });
            }
        });

        describe("object fields", () => {
            const testCases = [
                {
                    cli: ["--httpHeaders", '{"fieldA": "3", "fieldB": "4"}'],
                    expected: { httpHeaders: { fieldA: "3", fieldB: "4" } },
                },
                {
                    cli: ["--httpHeaders.fieldA", "3", "--httpHeaders.fieldB", "4"],
                    expected: { httpHeaders: { fieldA: "3", fieldB: "4" } },
                },
            ] as { cli: string[]; expected: Partial<UserConfig> }[];
            for (const { cli, expected } of testCases) {
                it(`should parse '${cli.join(" ")}' to ${JSON.stringify(expected)}`, () => {
                    const { parsed } = parseUserConfig({
                        args: cli,
                    });
                    expect(parsed?.httpHeaders).toStrictEqual(expected.httpHeaders);
                });
            }

            it("cannot mix --httpHeaders and --httpHeaders.fieldX", () => {
                expect(
                    parseUserConfig({
                        args: ["--httpHeaders", '{"fieldA": "3", "fieldB": "4"}', "--httpHeaders.fieldA", "5"],
                    })
                ).toStrictEqual({
                    error: "Invalid configuration for the following fields:\nhttpHeaders - Invalid input: expected object, received array",
                    warnings: [],
                    parsed: undefined,
                });
            });
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
                    expected: { tls: true },
                },
                {
                    cli: ["--sslAllowInvalidCertificates"],
                    expected: { tlsAllowInvalidCertificates: true },
                },
                {
                    cli: ["--sslAllowInvalidHostnames"],
                    expected: { tlsAllowInvalidHostnames: true },
                },
                {
                    cli: ["--tlsFIPSMode"],
                    expected: { tlsFIPSMode: true },
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
                {
                    cli: ["--readOnly"],
                    expected: { readOnly: true },
                },
                {
                    cli: ["--readOnly", "false"],
                    expected: { readOnly: false },
                },
                {
                    cli: ["--readOnly", "FALSE"],
                    // This is yargs-parser default
                    expected: { readOnly: true },
                },
                {
                    cli: ["--readOnly", "0"],
                    // This is yargs-parser default
                    expected: { readOnly: true },
                },
                {
                    cli: ["--readOnly", "1"],
                    expected: { readOnly: true },
                },
                {
                    cli: ["--readOnly", "true"],
                    expected: { readOnly: true },
                },
                {
                    cli: ["--readOnly", "yes"],
                    expected: { readOnly: true },
                },
                {
                    cli: ["--readOnly", "no"],
                    expected: { readOnly: true },
                },
                {
                    cli: ["--readOnly", ""],
                    expected: { readOnly: true },
                },
            ] as { cli: string[]; expected: Partial<UserConfig> }[];

            for (const { cli, expected } of testCases) {
                it(`should parse '${cli.join(" ")}' to ${JSON.stringify(expected)}`, () => {
                    const { parsed: actual } = parseUserConfig({
                        args: cli,
                    });
                    for (const [key, value] of Object.entries(expected)) {
                        expect(actual?.[key as keyof UserConfig]).toBe(value);
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
                    const { parsed: actual } = parseUserConfig({
                        args: cli,
                    });
                    for (const [key, value] of Object.entries(expected)) {
                        expect(actual?.[key as keyof UserConfig]).toEqual(value);
                    }
                });
            }
        });
    });

    describe("loading a config file", () => {
        describe("through env variable MDB_MCP_CONFIG", () => {
            const { setVariable, clearVariables } = createEnvironment();
            afterEach(() => {
                clearVariables();
            });

            it("should load a valid config file without troubles", () => {
                setVariable("MDB_MCP_CONFIG", CONFIG_FIXTURES.VALID);
                const { warnings, error, parsed } = parseUserConfig({ args: [] });
                expect(warnings).toHaveLength(0);
                expect(error).toBeUndefined();

                expect(parsed?.connectionString).toBe("mongodb://valid-json-localhost:1000");
                expect(parsed?.loggers).toStrictEqual(["stderr"]);
            });

            it("should attempt loading config file with wrong value and exit", () => {
                setVariable("MDB_MCP_CONFIG", CONFIG_FIXTURES.WITH_INVALID_VALUE);
                const { warnings, error, parsed } = parseUserConfig({ args: [] });
                expect(warnings).toHaveLength(0);
                expect(error).toEqual(expect.stringContaining("loggers - Duplicate loggers found in config"));
                expect(parsed).toBeUndefined();
            });
        });

        describe("through cli argument --config", () => {
            it("should load a valid config file without troubles", () => {
                const { warnings, error, parsed } = parseUserConfig({ args: ["--config", CONFIG_FIXTURES.VALID] });
                expect(warnings).toHaveLength(0);
                expect(error).toBeUndefined();

                expect(parsed?.connectionString).toBe("mongodb://valid-json-localhost:1000");
                expect(parsed?.loggers).toStrictEqual(["stderr"]);
            });

            it("should attempt loading config file with wrong value and exit", () => {
                const { warnings, error, parsed } = parseUserConfig({
                    args: ["--config", CONFIG_FIXTURES.WITH_INVALID_VALUE],
                });
                expect(warnings).toHaveLength(0);
                expect(error).toEqual(expect.stringContaining("loggers - Duplicate loggers found in config"));
                expect(parsed).toBeUndefined();
            });
        });
    });

    describe("precedence rules", () => {
        const { setVariable, clearVariables } = createEnvironment();

        afterEach(() => {
            clearVariables();
        });

        it("positional argument takes precedence over all", () => {
            setVariable("MDB_MCP_CONNECTION_STRING", "mongodb://crazyhost1");
            const { parsed: actual } = parseUserConfig({
                args: [
                    "mongodb://crazyhost2",
                    "--config",
                    CONFIG_FIXTURES.VALID,
                    "--connectionString",
                    "mongodb://localhost",
                ],
            });
            expect(actual?.connectionString).toBe("mongodb://crazyhost2/?directConnection=true");
        });

        it("any cli argument takes precedence over env vars, config and defaults", () => {
            setVariable("MDB_MCP_CONNECTION_STRING", "mongodb://dummyhost");
            const { parsed } = parseUserConfig({
                args: ["--config", CONFIG_FIXTURES.VALID, "--connectionString", "mongodb://host-from-cli"],
            });
            expect(parsed?.connectionString).toBe("mongodb://host-from-cli");
        });

        it("any env var takes precedence over config and defaults", () => {
            setVariable("MDB_MCP_CONNECTION_STRING", "mongodb://dummyhost");
            const { parsed } = parseUserConfig({ args: ["--config", CONFIG_FIXTURES.VALID] });
            expect(parsed?.connectionString).toBe("mongodb://dummyhost");
        });

        it("config file takes precedence over defaults", () => {
            const { parsed } = parseUserConfig({ args: ["--config", CONFIG_FIXTURES.VALID] });
            expect(parsed?.connectionString).toBe("mongodb://valid-json-localhost:1000");
        });
    });

    describe("consolidation", () => {
        it("positional argument for url has precedence over --connectionString", () => {
            const { parsed: actual } = parseUserConfig({
                args: ["mongodb://localhost", "--connectionString", "mongodb://toRemoveHost"],
            });
            // the shell specifies directConnection=true and serverSelectionTimeoutMS=2000 by default
            expect(actual?.connectionString).toBe(
                "mongodb://localhost/?directConnection=true&serverSelectionTimeoutMS=2000"
            );
        });

        it("positional argument is always considered", () => {
            const { parsed: actual } = parseUserConfig({
                args: ["mongodb://localhost"],
            });
            // the shell specifies directConnection=true and serverSelectionTimeoutMS=2000 by default
            expect(actual?.connectionString).toBe(
                "mongodb://localhost/?directConnection=true&serverSelectionTimeoutMS=2000"
            );
        });
    });

    describe("validation", () => {
        describe("transport", () => {
            it("should support http", () => {
                const { parsed: actual } = parseUserConfig({
                    args: ["--transport", "http"],
                });
                expect(actual?.transport).toEqual("http");
            });

            it("should support stdio", () => {
                const { parsed: actual } = parseUserConfig({
                    args: ["--transport", "stdio"],
                });
                expect(actual?.transport).toEqual("stdio");
            });

            it("should not support sse", () => {
                const { error } = parseUserConfig({
                    args: ["--transport", "sse"],
                });
                expect(error).toEqual(
                    expect.stringContaining(
                        'Invalid configuration for the following fields:\ntransport - Invalid option: expected one of "stdio"|"http"'
                    )
                );
            });

            it("should not support arbitrary values", () => {
                const value = Math.random() + "transport";
                const { error } = parseUserConfig({
                    args: ["--transport", value],
                });
                expect(error).toEqual(
                    expect.stringContaining(
                        'Invalid configuration for the following fields:\ntransport - Invalid option: expected one of "stdio"|"http"'
                    )
                );
            });
        });

        describe("telemetry", () => {
            it("can be enabled", () => {
                const { parsed: actual } = parseUserConfig({
                    args: ["--telemetry", "enabled"],
                });
                expect(actual?.telemetry).toEqual("enabled");
            });

            it("can be disabled", () => {
                const { parsed: actual } = parseUserConfig({
                    args: ["--telemetry", "disabled"],
                });
                expect(actual?.telemetry).toEqual("disabled");
            });

            it("should not support the boolean true value", () => {
                const { error } = parseUserConfig({
                    args: ["--telemetry", "true"],
                });
                expect(error).toEqual(
                    expect.stringContaining(
                        'Invalid configuration for the following fields:\ntelemetry - Invalid option: expected one of "enabled"|"disabled"'
                    )
                );
            });

            it("should not support the boolean false value", () => {
                const { error } = parseUserConfig({
                    args: ["--telemetry", "false"],
                });
                expect(error).toEqual(
                    expect.stringContaining(
                        'Invalid configuration for the following fields:\ntelemetry - Invalid option: expected one of "enabled"|"disabled"'
                    )
                );
            });

            it("should not support arbitrary values", () => {
                const value = Math.random() + "telemetry";
                const { error } = parseUserConfig({
                    args: ["--telemetry", value],
                });
                expect(error).toEqual(
                    expect.stringContaining(
                        'Invalid configuration for the following fields:\ntelemetry - Invalid option: expected one of "enabled"|"disabled"'
                    )
                );
            });
        });

        describe("httpPort", () => {
            it("must be above 0", () => {
                const { error } = parseUserConfig({
                    args: ["--httpPort", "-1"],
                });
                expect(error).toEqual(
                    expect.stringContaining(
                        "Invalid configuration for the following fields:\nhttpPort - Invalid httpPort: must be at least 0"
                    )
                );
            });

            it("must be below 65535 (OS limit)", () => {
                const { error } = parseUserConfig({
                    args: ["--httpPort", "89527345"],
                });
                expect(error).toEqual(
                    expect.stringContaining(
                        "Invalid configuration for the following fields:\nhttpPort - Invalid httpPort: must be at most 65535"
                    )
                );
            });

            it("should not support non numeric values", () => {
                const { error } = parseUserConfig({
                    args: ["--httpPort", "portAventura"],
                });
                expect(error).toEqual(
                    expect.stringContaining(
                        "Invalid configuration for the following fields:\nhttpPort - Invalid input: expected number, received NaN"
                    )
                );
            });

            it("should support numeric values", () => {
                const { parsed: actual } = parseUserConfig({ args: ["--httpPort", "8888"] });
                expect(actual?.httpPort).toEqual(8888);
            });
        });

        describe("loggers", () => {
            const invalidLoggerTestCases = [
                {
                    description: "must not be empty",
                    args: ["--loggers", ""],
                    expectedError:
                        "Invalid configuration for the following fields:\nloggers - Cannot be an empty array",
                },
                {
                    description: "must not allow duplicates",
                    args: ["--loggers", "disk,disk,disk"],
                    expectedError:
                        "Invalid configuration for the following fields:\nloggers - Duplicate loggers found in config",
                },
            ];

            for (const { description, args, expectedError } of invalidLoggerTestCases) {
                it(description, () => {
                    const { error } = parseUserConfig({ args });
                    expect(error).toEqual(expect.stringContaining(expectedError));
                });
            }

            it("allows mcp logger", () => {
                const { parsed: actual } = parseUserConfig({ args: ["--loggers", "mcp"] });
                expect(actual?.loggers).toEqual(["mcp"]);
            });

            it("allows disk logger", () => {
                const { parsed: actual } = parseUserConfig({ args: ["--loggers", "disk"] });
                expect(actual?.loggers).toEqual(["disk"]);
            });

            it("allows stderr logger", () => {
                const { parsed: actual } = parseUserConfig({ args: ["--loggers", "stderr"] });
                expect(actual?.loggers).toEqual(["stderr"]);
            });
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
            parseUserConfig({ args: [`--${cliArg}`, cliArg] });
            expect(keychain.allSecrets).toEqual([{ value: cliArg, kind: secretKind }]);
        });
    }

    const secretsFromSchema = Object.keys(UserConfigSchema.shape).filter((key) => {
        const meta = getConfigMeta(key as keyof UserConfig);
        return meta?.isSecret === true;
    });

    for (const secretKey of secretsFromSchema) {
        it(`should register ${secretKey} as a secret in the root keychain`, () => {
            parseUserConfig({ args: [`--${secretKey}`, secretKey] });

            const registeredSecret = keychain.allSecrets.find((s) => s.value === secretKey);
            expect(registeredSecret).toBeDefined();
        });
    }
});

describe("custom override logic functions", () => {
    describe("onlyLowerThanBaseValueOverride", () => {
        it("should allow override to a lower value", () => {
            const customLogic = onlyLowerThanBaseValueOverride();
            const result = customLogic(100, 50);
            expect(result).toBe(50);
        });

        it("should reject override to a higher value", () => {
            const customLogic = onlyLowerThanBaseValueOverride();
            expect(() => customLogic(100, 150)).toThrow("Can only set to a value lower than the base value");
        });

        it("should reject override to equal value", () => {
            const customLogic = onlyLowerThanBaseValueOverride();
            expect(() => customLogic(100, 100)).toThrow("Can only set to a value lower than the base value");
        });

        it("should throw error if base value is not a number", () => {
            const customLogic = onlyLowerThanBaseValueOverride();
            expect(() => customLogic("not a number", 50)).toThrow("Unsupported type for base value for override");
        });

        it("should throw error if new value is not a number", () => {
            const customLogic = onlyLowerThanBaseValueOverride();
            expect(() => customLogic(100, "not a number")).toThrow("Unsupported type for new value for override");
        });
    });

    describe("onlySubsetOfBaseValueOverride", () => {
        it("should allow override to a subset", () => {
            const customLogic = onlySubsetOfBaseValueOverride();
            const result = customLogic(["a", "b", "c"], ["a", "b"]);
            expect(result).toEqual(["a", "b"]);
        });

        it("should allow override to an empty array", () => {
            const customLogic = onlySubsetOfBaseValueOverride();
            const result = customLogic(["a", "b", "c"], []);
            expect(result).toEqual([]);
        });

        it("should allow override with same array", () => {
            const customLogic = onlySubsetOfBaseValueOverride();
            const result = customLogic(["a", "b"], ["a", "b"]);
            expect(result).toEqual(["a", "b"]);
        });

        it("should reject override to a superset", () => {
            const customLogic = onlySubsetOfBaseValueOverride();
            expect(() => customLogic(["a", "b"], ["a", "b", "c"])).toThrow(
                "Can only override to a subset of the base value"
            );
        });

        it("should reject override with items not in base value", () => {
            const customLogic = onlySubsetOfBaseValueOverride();
            expect(() => customLogic(["a", "b"], ["c"])).toThrow("Can only override to a subset of the base value");
        });

        it("should reject override when base is empty and new is not", () => {
            const customLogic = onlySubsetOfBaseValueOverride();
            expect(() => customLogic([], ["a"])).toThrow("Can only override to a subset of the base value");
        });

        it("should allow override when both arrays are empty", () => {
            const customLogic = onlySubsetOfBaseValueOverride();
            const result = customLogic([], []);
            expect(result).toEqual([]);
        });

        it("should throw error if base value is not an array", () => {
            const customLogic = onlySubsetOfBaseValueOverride();
            expect(() => customLogic("not an array", ["a"])).toThrow("Unsupported type for base value for override");
        });

        it("should throw error if new value is not an array", () => {
            const customLogic = onlySubsetOfBaseValueOverride();
            expect(() => customLogic(["a", "b"], "not an array")).toThrow(
                "Unsupported type for new value for override"
            );
        });
    });
});
