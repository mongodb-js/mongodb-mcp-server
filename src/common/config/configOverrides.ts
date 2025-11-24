import type { UserConfig } from "./userConfig.js";
import { UserConfigSchema, configRegistry } from "./userConfig.js";
import type { RequestContext } from "../../transports/base.js";
import type { ConfigFieldMeta, OverrideBehavior } from "./configUtils.js";

export const CONFIG_HEADER_PREFIX = "x-mongodb-mcp-";
export const CONFIG_QUERY_PREFIX = "mongodbMcp";

/**
 * Applies config overrides from request context (headers and query parameters).
 * Query parameters take precedence over headers.
 *
 * @param baseConfig - The base user configuration
 * @param request - The request context containing headers and query parameters
 * @returns The configuration with overrides applied
 */
export function applyConfigOverrides({
    baseConfig,
    request,
}: {
    baseConfig: UserConfig;
    request?: RequestContext;
}): UserConfig {
    if (!request) {
        return baseConfig;
    }

    const result: UserConfig = { ...baseConfig };
    const overridesFromHeaders = extractConfigOverrides("header", request.headers);
    const overridesFromQuery = extractConfigOverrides("query", request.query);

    // Merge overrides, with query params taking precedence
    const allOverrides = { ...overridesFromHeaders, ...overridesFromQuery };

    // Apply each override according to its behavior
    for (const [key, overrideValue] of Object.entries(allOverrides)) {
        assertValidConfigKey(key);
        const behavior = getConfigMeta(key)?.overrideBehavior || "not-allowed";
        const baseValue = baseConfig[key as keyof UserConfig];
        const newValue = applyOverride(key, baseValue, overrideValue, behavior);
        (result as Record<keyof UserConfig, unknown>)[key] = newValue;
    }

    return result;
}

/**
 * Extracts config overrides from HTTP headers or query parameters.
 */
function extractConfigOverrides(
    mode: "header" | "query",
    source: Record<string, string | string[] | undefined> | undefined
): Partial<Record<keyof typeof UserConfigSchema.shape, unknown>> {
    if (!source) {
        return {};
    }

    const overrides: Partial<Record<keyof typeof UserConfigSchema.shape, unknown>> = {};

    for (const [name, value] of Object.entries(source)) {
        const configKey = nameToConfigKey(mode, name);
        if (!configKey) {
            continue;
        }
        assertValidConfigKey(configKey);

        const behavior = getConfigMeta(configKey)?.overrideBehavior || "not-allowed";
        if (behavior === "not-allowed") {
            throw new Error(`Config key ${configKey} is not allowed to be overridden`);
        }

        const parsedValue = parseConfigValue(configKey, value);
        if (parsedValue !== undefined) {
            overrides[configKey] = parsedValue;
        }
    }

    return overrides;
}

function assertValidConfigKey(key: string): asserts key is keyof typeof UserConfigSchema.shape {
    if (!(key in UserConfigSchema.shape)) {
        throw new Error(`Invalid config key: ${key}`);
    }
}

/**
 * Gets the schema metadata for a config key.
 */
export function getConfigMeta(key: keyof typeof UserConfigSchema.shape): ConfigFieldMeta | undefined {
    return configRegistry.get(UserConfigSchema.shape[key]);
}

/**
 * Parses a string value to the appropriate type using the Zod schema.
 */
function parseConfigValue(key: keyof typeof UserConfigSchema.shape, value: unknown): unknown {
    const fieldSchema = UserConfigSchema.shape[key];
    if (!fieldSchema) {
        throw new Error(`Invalid config key: ${key}`);
    }

    return fieldSchema.safeParse(value).data;
}

/**
 * Converts a header/query name to its config key format.
 * Example: "x-mongodb-mcp-read-only" -> "readOnly"
 * Example: "mongodbMcpReadOnly" -> "readOnly"
 */
export function nameToConfigKey(mode: "header" | "query", name: string): string | undefined {
    const lowerCaseName = name.toLowerCase();

    if (mode === "header" && lowerCaseName.startsWith(CONFIG_HEADER_PREFIX)) {
        const normalized = lowerCaseName.substring(CONFIG_HEADER_PREFIX.length);
        // Convert kebab-case to camelCase
        return normalized.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    }
    if (mode === "query" && name.startsWith(CONFIG_QUERY_PREFIX)) {
        const withoutPrefix = name.substring(CONFIG_QUERY_PREFIX.length);
        // Convert first letter to lowercase to get config key
        return withoutPrefix.charAt(0).toLowerCase() + withoutPrefix.slice(1);
    }

    return undefined;
}

function applyOverride(
    key: keyof typeof UserConfigSchema.shape,
    baseValue: unknown,
    overrideValue: unknown,
    behavior: OverrideBehavior
): unknown {
    if (typeof behavior === "function") {
        // Custom logic function returns the value to use (potentially transformed)
        // or throws an error if the override cannot be applied
        try {
            return behavior(baseValue, overrideValue);
        } catch (error) {
            throw new Error(
                `Cannot apply override for ${key} from ${JSON.stringify(baseValue)} to ${JSON.stringify(overrideValue)}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
    switch (behavior) {
        case "override":
            return overrideValue;

        case "merge":
            if (Array.isArray(baseValue) && Array.isArray(overrideValue)) {
                return [...(baseValue as unknown[]), ...(overrideValue as unknown[])];
            }
            throw new Error("Cannot merge non-array values, did you mean to use the 'override' behavior?");

        case "not-allowed":
        default:
            return baseValue;
    }
}
