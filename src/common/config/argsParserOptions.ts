type ArgsParserOptions = {
    string: string[];
    number: string[];
    boolean: string[];
    array: string[];
    alias: Record<string, string>;
    configuration: Record<string, boolean>;
};

// TODO: Export this from arg-parser or find a better way to do this
// From: https://github.com/mongodb-js/mongosh/blob/main/packages/cli-repl/src/arg-parser.ts
export const OPTIONS = {
    number: ["maxDocumentsPerQuery", "maxBytesPerQuery"],
    string: [
        "apiBaseUrl",
        "apiClientId",
        "apiClientSecret",
        "connectionString",
        "httpHost",
        "httpPort",
        "idleTimeoutMs",
        "logPath",
        "notificationTimeoutMs",
        "telemetry",
        "transport",
        "apiVersion",
        "authenticationDatabase",
        "authenticationMechanism",
        "browser",
        "db",
        "gssapiHostName",
        "gssapiServiceName",
        "host",
        "oidcFlows",
        "oidcRedirectUri",
        "password",
        "port",
        "sslCAFile",
        "sslCRLFile",
        "sslCertificateSelector",
        "sslDisabledProtocols",
        "sslPEMKeyFile",
        "sslPEMKeyPassword",
        "sspiHostnameCanonicalization",
        "sspiRealmOverride",
        "tlsCAFile",
        "tlsCRLFile",
        "tlsCertificateKeyFile",
        "tlsCertificateKeyFilePassword",
        "tlsCertificateSelector",
        "tlsDisabledProtocols",
        "username",
        "atlasTemporaryDatabaseUserLifetimeMs",
        "exportsPath",
        "exportTimeoutMs",
        "exportCleanupIntervalMs",
        "voyageApiKey",
    ],
    boolean: [
        "apiDeprecationErrors",
        "apiStrict",
        "disableEmbeddingsValidation",
        "help",
        "indexCheck",
        "ipv6",
        "nodb",
        "oidcIdTokenAsAccessToken",
        "oidcNoNonce",
        "oidcTrustedEndpoint",
        "readOnly",
        "retryWrites",
        "ssl",
        "sslAllowInvalidCertificates",
        "sslAllowInvalidHostnames",
        "sslFIPSMode",
        "tls",
        "tlsAllowInvalidCertificates",
        "tlsAllowInvalidHostnames",
        "tlsFIPSMode",
        "version",
    ],
    array: ["disabledTools", "loggers", "confirmationRequiredTools", "previewFeatures"],
    alias: {
        h: "help",
        p: "password",
        u: "username",
        "build-info": "buildInfo",
        browser: "browser",
        oidcDumpTokens: "oidcDumpTokens",
        oidcRedirectUrl: "oidcRedirectUri",
        oidcIDTokenAsAccessToken: "oidcIdTokenAsAccessToken",
    },
    configuration: {
        "camel-case-expansion": false,
        "unknown-options-as-args": true,
        "parse-positional-numbers": false,
        "parse-numbers": false,
        "greedy-arrays": true,
        "short-option-groups": false,
    },
} as Readonly<ArgsParserOptions>;

export const ALL_CONFIG_KEYS = new Set(
    (OPTIONS.string as readonly string[])
        .concat(OPTIONS.number)
        .concat(OPTIONS.array)
        .concat(OPTIONS.boolean)
        .concat(Object.keys(OPTIONS.alias))
);
