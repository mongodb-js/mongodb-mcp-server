import { describe, it, expect } from "vitest";
import { applyConfigOverrides, getConfigMeta, nameToConfigKey } from "../../../../src/common/config/configOverrides.js";
import { UserConfigSchema, type UserConfig } from "../../../../src/common/config/userConfig.js";
import type { RequestContext } from "../../../../src/transports/base.js";

describe("configOverrides", () => {
    const baseConfig: Partial<UserConfig> = {
        readOnly: false,
        indexCheck: false,
        idleTimeoutMs: 600_000,
        notificationTimeoutMs: 540_000,
        disabledTools: ["tool1"],
        confirmationRequiredTools: ["drop-database"],
        connectionString: "mongodb://localhost:27017",
        vectorSearchDimensions: 1024,
        vectorSearchSimilarityFunction: "euclidean",
        embeddingsValidation: false,
        previewFeatures: [],
        loggers: ["disk", "mcp"],
        exportTimeoutMs: 300_000,
        exportCleanupIntervalMs: 120_000,
        atlasTemporaryDatabaseUserLifetimeMs: 14_400_000,
        allowRequestOverrides: true,
    };

    describe("helper functions", () => {
        describe("nameToConfigKey", () => {
            it("should convert header name to config key", () => {
                expect(nameToConfigKey("header", "x-mongodb-mcp-read-only")).toBe("readOnly");
                expect(nameToConfigKey("header", "x-mongodb-mcp-idle-timeout-ms")).toBe("idleTimeoutMs");
                expect(nameToConfigKey("header", "x-mongodb-mcp-connection-string")).toBe("connectionString");
            });

            it("should convert query parameter name to config key", () => {
                expect(nameToConfigKey("query", "mongodbMcpReadOnly")).toBe("readOnly");
                expect(nameToConfigKey("query", "mongodbMcpIdleTimeoutMs")).toBe("idleTimeoutMs");
                expect(nameToConfigKey("query", "mongodbMcpConnectionString")).toBe("connectionString");
            });

            it("should not mix up header and query parameter names", () => {
                expect(nameToConfigKey("header", "mongodbMcpReadOnly")).toBeUndefined();
                expect(nameToConfigKey("query", "x-mongodb-mcp-read-only")).toBeUndefined();
            });

            it("should return undefined for non-mcp names", () => {
                expect(nameToConfigKey("header", "content-type")).toBeUndefined();
                expect(nameToConfigKey("header", "authorization")).toBeUndefined();
                expect(nameToConfigKey("query", "content")).toBeUndefined();
            });
        });

        it("should get override behavior for config keys", () => {
            expect(getConfigMeta("readOnly")?.overrideBehavior).toEqual(expect.any(Function));
            expect(getConfigMeta("disabledTools")?.overrideBehavior).toBe("merge");
            expect(getConfigMeta("apiBaseUrl")?.overrideBehavior).toBe("not-allowed");
            expect(getConfigMeta("maxBytesPerQuery")?.overrideBehavior).toBe("not-allowed");
        });
    });

    describe("applyConfigOverrides", () => {
        it("should return base config when request is undefined", () => {
            const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig });
            expect(result).toEqual(baseConfig);
        });

        describe("boolean edge cases", () => {
            it("should parse correctly for true value", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-read-only": "true",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.readOnly).toBe(true);
            });

            it("should parse correctly for false value", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-read-only": "false",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.readOnly).toBe(false);
            });

            for (const value of ["True", "False", "TRUE", "FALSE", "0", "1", ""]) {
                it(`should throw an error for ${value}`, () => {
                    const request: RequestContext = {
                        headers: {
                            "x-mongodb-mcp-read-only": value,
                        },
                    };
                    expect(() => applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request })).toThrow(
                        `Invalid boolean value: ${value}`
                    );
                });
            }
        });

        it("should return base config when request has no headers or query", () => {
            const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request: {} });
            expect(result).toEqual(baseConfig);
        });

        describe("allowRequestOverrides", () => {
            it("should not apply overrides when allowRequestOverrides is false", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-read-only": "true",
                        "x-mongodb-mcp-idle-timeout-ms": "300000",
                    },
                };
                const configWithOverridesDisabled = {
                    ...baseConfig,
                    allowRequestOverrides: false,
                } as UserConfig;
                expect(() => applyConfigOverrides({ baseConfig: configWithOverridesDisabled, request })).to.throw(
                    "Request overrides are not enabled"
                );
            });

            it("should apply overrides when allowRequestOverrides is true", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-read-only": "true",
                        "x-mongodb-mcp-idle-timeout-ms": "300000",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                // Config should be overridden
                expect(result.readOnly).toBe(true);
                expect(result.idleTimeoutMs).toBe(300000);
            });

            it("should not apply overrides by default when allowRequestOverrides is not set", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-read-only": "true",
                    },
                };
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { allowRequestOverrides, ...configWithoutOverridesFlag } = baseConfig;
                expect(() =>
                    applyConfigOverrides({ baseConfig: configWithoutOverridesFlag as UserConfig, request })
                ).to.throw("Request overrides are not enabled");
            });
        });

        describe("override behavior", () => {
            it("should override boolean values with override behavior", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-read-only": "true",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.readOnly).toBe(true);
            });

            it("should override string values with override behavior", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-vector-search-similarity-function": "cosine",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.vectorSearchSimilarityFunction).toBe("cosine");
            });
        });

        describe("merge behavior", () => {
            it("should merge array values", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-disabled-tools": "tool2,tool3",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.disabledTools).toEqual(["tool1", "tool2", "tool3"]);
            });

            it("should merge multiple array fields", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-disabled-tools": "tool2",
                        "x-mongodb-mcp-confirmation-required-tools": "drop-collection",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.disabledTools).toEqual(["tool1", "tool2"]);
                expect(result.confirmationRequiredTools).toEqual(["drop-database", "drop-collection"]);
                // previewFeatures has enum validation - "feature1" isn't a valid value, so it gets rejected
                expect(result.previewFeatures).toEqual([]);
            });

            it("should not be able to merge loggers", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-loggers": "stderr",
                    },
                };
                expect(() => applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request })).toThrow(
                    "Config key loggers is not allowed to be overridden"
                );
            });
        });

        describe("not-allowed behavior", () => {
            it("should have some not-allowed fields", () => {
                expect(
                    Object.keys(UserConfigSchema.shape).filter(
                        (key) =>
                            getConfigMeta(key as keyof typeof UserConfigSchema.shape)?.overrideBehavior ===
                            "not-allowed"
                    )
                ).toEqual(
                    expect.arrayContaining([
                        "apiBaseUrl",
                        "apiClientId",
                        "apiClientSecret",
                        "connectionString",
                        "loggers",
                        "logPath",
                        "telemetry",
                        "transport",
                        "httpPort",
                        "httpHost",
                        "httpHeaders",
                        "httpBodyLimit",
                        "maxBytesPerQuery",
                        "maxDocumentsPerQuery",
                        "exportsPath",
                        "exportCleanupIntervalMs",
                        "voyageApiKey",
                        "allowRequestOverrides",
                        "dryRun",
                        "externallyManagedSessions",
                        "httpResponseType",
                        "healthCheckHost",
                        "healthCheckPort",
                    ])
                );
            });

            it("should throw an error for not-allowed fields", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-api-base-url": "https://malicious.com/",
                        "x-mongodb-mcp-max-bytes-per-query": "999999",
                        "x-mongodb-mcp-max-documents-per-query": "1000",
                        "x-mongodb-mcp-transport": "stdio",
                        "x-mongodb-mcp-http-port": "9999",
                    },
                };
                expect(() => applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request })).toThrow(
                    "Config key apiBaseUrl is not allowed to be overridden"
                );
            });
        });

        describe("secret fields", () => {
            const secretFields = Object.keys(UserConfigSchema.shape).filter((configKey) => {
                const meta = getConfigMeta(configKey as keyof UserConfig);
                return meta?.isSecret;
            });

            it.each(secretFields)("should not allow overriding secret fields - $0", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-voyage-api-key": "test",
                    },
                };
                expect(() => applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request })).toThrow(
                    "Config key voyageApiKey is not allowed to be overridden"
                );
            });
        });

        describe("custom overrides", () => {
            it("should have certain config keys to be conditionally overridden", () => {
                expect(
                    Object.keys(UserConfigSchema.shape)
                        .map((key) => [
                            key,
                            getConfigMeta(key as keyof typeof UserConfigSchema.shape)?.overrideBehavior,
                        ])
                        .filter(([, behavior]) => typeof behavior === "function")
                        .map(([key]) => key)
                ).toEqual([
                    "readOnly",
                    "indexCheck",
                    "idleTimeoutMs",
                    "notificationTimeoutMs",
                    "exportTimeoutMs",
                    "atlasTemporaryDatabaseUserLifetimeMs",
                    "embeddingsValidation",
                    "previewFeatures",
                ]);
            });

            it("should allow readOnly override from false to true", () => {
                const request: RequestContext = { headers: { "x-mongodb-mcp-read-only": "true" } };
                const result = applyConfigOverrides({
                    baseConfig: { ...baseConfig, readOnly: false } as UserConfig,
                    request,
                });
                expect(result.readOnly).toBe(true);
            });

            it("should throw when trying to override readOnly from true to false", () => {
                const request: RequestContext = { headers: { "x-mongodb-mcp-read-only": "false" } };
                expect(() =>
                    applyConfigOverrides({ baseConfig: { ...baseConfig, readOnly: true } as UserConfig, request })
                ).toThrow("Cannot apply override for readOnly: Can only set to true");
            });

            it("should allow indexCheck override from false to true", () => {
                const request: RequestContext = { headers: { "x-mongodb-mcp-index-check": "true" } };
                const result = applyConfigOverrides({
                    baseConfig: { ...baseConfig, indexCheck: false } as UserConfig,
                    request,
                });
                expect(result.indexCheck).toBe(true);
            });

            it("should throw when trying to override indexCheck from true to false", () => {
                const request: RequestContext = { headers: { "x-mongodb-mcp-index-check": "false" } };
                expect(() =>
                    applyConfigOverrides({ baseConfig: { ...baseConfig, indexCheck: true } as UserConfig, request })
                ).toThrow("Cannot apply override for indexCheck: Can only set to true");
            });

            it("should allow disableEmbeddingsValidation override from true to false", () => {
                const request: RequestContext = { headers: { "x-mongodb-mcp-embeddings-validation": "true" } };
                const result = applyConfigOverrides({
                    baseConfig: { ...baseConfig, embeddingsValidation: true } as UserConfig,
                    request,
                });
                expect(result.embeddingsValidation).toBe(true);
            });

            it("should throw when trying to override embeddingsValidation from false to true", () => {
                const request: RequestContext = { headers: { "x-mongodb-mcp-embeddings-validation": "false" } };
                expect(() =>
                    applyConfigOverrides({
                        baseConfig: { ...baseConfig, embeddingsValidation: true } as UserConfig,
                        request,
                    })
                ).toThrow("Cannot apply override for embeddingsValidation: Can only set to true");
            });
        });

        describe("query parameter overrides", () => {
            it("should apply overrides from query parameters", () => {
                const request: RequestContext = {
                    query: {
                        mongodbMcpReadOnly: "true",
                        mongodbMcpIdleTimeoutMs: "400000",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.readOnly).toBe(true);
                expect(result.idleTimeoutMs).toBe(400000);
            });

            it("should merge arrays from query parameters", () => {
                const request: RequestContext = {
                    query: {
                        mongodbMcpDisabledTools: "tool2,tool3",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.disabledTools).toEqual(["tool1", "tool2", "tool3"]);
            });
        });

        describe("precedence", () => {
            it("should give query parameters precedence over headers", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-idle-timeout-ms": "300000",
                    },
                    query: {
                        mongodbMcpIdleTimeoutMs: "500000",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.idleTimeoutMs).toBe(500000);
            });

            it("should merge arrays from both headers and query", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-disabled-tools": "tool2",
                    },
                    query: {
                        mongodbMcpDisabledTools: "tool3",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                // Query takes precedence over headers, but base + query result
                expect(result.disabledTools).toEqual(["tool1", "tool3"]);
            });
        });

        describe("edge cases", () => {
            it("should error with values which do not match the schema", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-idle-timeout-ms": "not-a-number",
                    },
                };
                expect(() => applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request })).toThrow(
                    "Invalid configuration for the following fields:\nidleTimeoutMs - Invalid input: expected number, received NaN"
                );
            });

            it("should handle empty string values for arrays", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-disabled-tools": "",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                // Empty string gets filtered out by commaSeparatedToArray, resulting in []
                // Merging [] with ["tool1"] gives ["tool1"]
                expect(result.disabledTools).toEqual(["tool1"]);
            });

            it("should trim whitespace in array values", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-disabled-tools": " tool2 , tool3 ",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.disabledTools).toEqual(["tool1", "tool2", "tool3"]);
            });

            it("should handle case-insensitive header names", () => {
                const request: RequestContext = {
                    headers: {
                        "X-MongoDB-MCP-Read-Only": "true",
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.readOnly).toBe(true);
            });

            it("should handle array values sent as multiple headers", () => {
                const request: RequestContext = {
                    headers: {
                        "x-mongodb-mcp-disabled-tools": ["tool2", "tool3"],
                    },
                };
                const result = applyConfigOverrides({ baseConfig: baseConfig as UserConfig, request });
                expect(result.disabledTools).toEqual(["tool1", "tool2", "tool3"]);
            });
        });
    });
});
