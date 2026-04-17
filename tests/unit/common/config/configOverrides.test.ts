import { describe, it, expect } from "vitest";
import { applyConfigOverrides, getConfigMeta, nameToConfigKey } from "../../../../src/common/config/configOverrides.js";
import { onlyStricterLogLevelOverride } from "../../../../src/common/config/configUtils.js";
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
                        "monitoringServerHost",
                        "monitoringServerPort",
                        "monitoringServerFeatures",
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
                    "mcpClientLogLevel",
                    "readOnly",
                    "indexCheck",
                    "idleTimeoutMs",
                    "notificationTimeoutMs",
                    "maxTimeMS",
                    "exportTimeoutMs",
                    "atlasTemporaryDatabaseUserLifetimeMs",
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

            describe("mcpClientLogLevel (onlyStricterLogLevelOverride)", () => {
                const baseConfigWithLogLevel = (level: string): UserConfig =>
                    ({ ...baseConfig, mcpClientLogLevel: level }) as UserConfig;

                // MCP log levels in order (least to most severe):
                // debug < info < notice < warning < error < critical < alert < emergency
                it("should allow override to the same log level (equal)", () => {
                    const request: RequestContext = {
                        headers: { "x-mongodb-mcp-mcp-client-log-level": "info" },
                    };
                    const result = applyConfigOverrides({
                        baseConfig: baseConfigWithLogLevel("info"),
                        request,
                    });
                    expect(result.mcpClientLogLevel).toBe("info");
                });

                it("should allow override to a stricter (higher severity) log level", () => {
                    // debug -> info (stricter)
                    const request1: RequestContext = {
                        headers: { "x-mongodb-mcp-mcp-client-log-level": "info" },
                    };
                    const result1 = applyConfigOverrides({
                        baseConfig: baseConfigWithLogLevel("debug"),
                        request: request1,
                    });
                    expect(result1.mcpClientLogLevel).toBe("info");

                    // debug -> error (stricter - skip multiple levels)
                    const request2: RequestContext = {
                        headers: { "x-mongodb-mcp-mcp-client-log-level": "error" },
                    };
                    const result2 = applyConfigOverrides({
                        baseConfig: baseConfigWithLogLevel("debug"),
                        request: request2,
                    });
                    expect(result2.mcpClientLogLevel).toBe("error");

                    // info -> warning (stricter - adjacent)
                    const request3: RequestContext = {
                        headers: { "x-mongodb-mcp-mcp-client-log-level": "warning" },
                    };
                    const result3 = applyConfigOverrides({
                        baseConfig: baseConfigWithLogLevel("info"),
                        request: request3,
                    });
                    expect(result3.mcpClientLogLevel).toBe("warning");

                    // warning -> emergency (stricter - most severe)
                    const request4: RequestContext = {
                        headers: { "x-mongodb-mcp-mcp-client-log-level": "emergency" },
                    };
                    const result4 = applyConfigOverrides({
                        baseConfig: baseConfigWithLogLevel("warning"),
                        request: request4,
                    });
                    expect(result4.mcpClientLogLevel).toBe("emergency");
                });

                it("should reject override to a looser (lower severity) log level", () => {
                    // error -> debug (looser)
                    const request: RequestContext = {
                        headers: { "x-mongodb-mcp-mcp-client-log-level": "debug" },
                    };
                    expect(() =>
                        applyConfigOverrides({ baseConfig: baseConfigWithLogLevel("error"), request })
                    ).toThrow("Can only override to a stricter (higher severity) log level");
                });

                it("should reject override to a looser adjacent log level", () => {
                    // warning -> info (looser - adjacent)
                    const request: RequestContext = {
                        headers: { "x-mongodb-mcp-mcp-client-log-level": "info" },
                    };
                    expect(() =>
                        applyConfigOverrides({ baseConfig: baseConfigWithLogLevel("warning"), request })
                    ).toThrow("Can only override to a stricter (higher severity) log level");
                });

                it("should reject override from most severe to any other level", () => {
                    // emergency -> emergency (same - allowed)
                    const sameRequest: RequestContext = {
                        headers: { "x-mongodb-mcp-mcp-client-log-level": "emergency" },
                    };
                    const sameResult = applyConfigOverrides({
                        baseConfig: baseConfigWithLogLevel("emergency"),
                        request: sameRequest,
                    });
                    expect(sameResult.mcpClientLogLevel).toBe("emergency");

                    // emergency -> anything else (rejected)
                    const looserRequest: RequestContext = {
                        headers: { "x-mongodb-mcp-mcp-client-log-level": "alert" },
                    };
                    expect(() =>
                        applyConfigOverrides({
                            baseConfig: baseConfigWithLogLevel("emergency"),
                            request: looserRequest,
                        })
                    ).toThrow("Can only override to a stricter (higher severity) log level");
                });

                it("should allow any override from least severe (debug)", () => {
                    // debug -> any level should be allowed
                    const levels = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"];
                    for (const level of levels) {
                        const request: RequestContext = {
                            headers: { "x-mongodb-mcp-mcp-client-log-level": level },
                        };
                        const result = applyConfigOverrides({
                            baseConfig: baseConfigWithLogLevel("debug"),
                            request,
                        });
                        expect(result.mcpClientLogLevel).toBe(level);
                    }
                });
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

describe("onlyStricterLogLevelOverride", () => {
    // Test with a custom ordered list to verify the logic works independently of MCP_LOG_LEVELS
    const testLevels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
    const overrideFn = onlyStricterLogLevelOverride(testLevels);

    describe("accept cases", () => {
        it("should allow equal log level (same value)", () => {
            expect(overrideFn("debug", "debug")).toBe("debug");
            expect(overrideFn("error", "error")).toBe("error");
        });

        it("should allow stricter (higher severity) log level", () => {
            // Adjacent levels
            expect(overrideFn("debug", "info")).toBe("info");
            expect(overrideFn("info", "warn")).toBe("warn");

            // Skip levels
            expect(overrideFn("trace", "error")).toBe("error");
            expect(overrideFn("debug", "fatal")).toBe("fatal");
        });

        it("should allow any override from least severe level", () => {
            for (const level of testLevels) {
                expect(overrideFn("trace", level)).toBe(level);
            }
        });
    });

    describe("reject cases", () => {
        it("should reject looser (lower severity) log level", () => {
            expect(() => overrideFn("error", "debug")).toThrow(
                "Can only override to a stricter (higher severity) log level"
            );
        });

        it("should reject adjacent looser level", () => {
            expect(() => overrideFn("warn", "info")).toThrow(
                "Can only override to a stricter (higher severity) log level"
            );
        });

        it("should reject any override from most severe level", () => {
            // Same level is allowed
            expect(overrideFn("fatal", "fatal")).toBe("fatal");

            // Any lower level is rejected
            for (const level of testLevels.slice(0, -1)) {
                expect(() => overrideFn("fatal", level)).toThrow(
                    "Can only override to a stricter (higher severity) log level"
                );
            }
        });
    });

    describe("error cases", () => {
        it("should throw for unknown old log level", () => {
            expect(() => overrideFn("unknown", "error")).toThrow("Unknown log level");
        });

        it("should throw for unknown new log level", () => {
            expect(() => overrideFn("error", "unknown")).toThrow("Unknown log level");
        });

        it("should throw when both levels are unknown", () => {
            expect(() => overrideFn("unknown1", "unknown2")).toThrow("Unknown log level");
        });

        it("should throw for non-string old value", () => {
            expect(() => overrideFn(123 as unknown as string, "error")).toThrow("Expected string log level values");
            expect(() => overrideFn(null as unknown as string, "error")).toThrow("Expected string log level values");
            expect(() => overrideFn(undefined as unknown as string, "error")).toThrow(
                "Expected string log level values"
            );
        });

        it("should throw for non-string new value", () => {
            expect(() => overrideFn("error", 123 as unknown as string)).toThrow("Expected string log level values");
            expect(() => overrideFn("error", null as unknown as string)).toThrow("Expected string log level values");
            expect(() => overrideFn("error", undefined as unknown as string)).toThrow(
                "Expected string log level values"
            );
        });

        it("should throw when both values are non-strings", () => {
            expect(() => overrideFn(123 as unknown as string, 456 as unknown as string)).toThrow(
                "Expected string log level values"
            );
        });
    });

    describe("edge cases with empty or single-level lists", () => {
        it("should handle single-level list", () => {
            const singleLevelFn = onlyStricterLogLevelOverride(["only"]);
            expect(singleLevelFn("only", "only")).toBe("only");
            // No stricter level exists, so any override to a different value fails first as unknown
            expect(() => singleLevelFn("only", "other")).toThrow("Unknown log level");
        });

        it("should handle two-level list", () => {
            const twoLevelFn = onlyStricterLogLevelOverride(["low", "high"]);
            expect(twoLevelFn("low", "low")).toBe("low");
            expect(twoLevelFn("low", "high")).toBe("high");
            expect(twoLevelFn("high", "high")).toBe("high");
            expect(() => twoLevelFn("high", "low")).toThrow(
                "Can only override to a stricter (higher severity) log level"
            );
        });
    });
});
