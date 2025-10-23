#!/usr/bin/env tsx

/**
 * This script generates environment variable definitions and updates:
 * - server.json environmentVariables arrays
 * - TODO: README.md configuration table
 *
 * It uses the Zod schema and OPTIONS defined in src/common/config.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { UserConfigSchema } from "../src/common/config.js";
import type { ZodObject, ZodRawShape } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function camelCaseToSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}

// List of configuration keys that contain sensitive/secret information
// These should be redacted in logs and marked as secret in environment variable definitions
const SECRET_CONFIG_KEYS = new Set([
    "connectionString",
    "username",
    "password",
    "apiClientId",
    "apiClientSecret",
    "tlsCAFile",
    "tlsCertificateKeyFile",
    "tlsCertificateKeyFilePassword",
    "tlsCRLFile",
    "sslCAFile",
    "sslPEMKeyFile",
    "sslPEMKeyPassword",
    "sslCRLFile",
    "voyageApiKey",
]);

interface ParsedOptions {
    string: string[];
    number: string[];
    boolean: string[];
    array: string[];
    alias: Record<string, string>;
}

interface EnvironmentVariable {
    name: string;
    description: string;
    isRequired: boolean;
    format: string;
    isSecret: boolean;
    configKey: string;
    defaultValue?: unknown;
}

interface ConfigMetadata {
    description: string;
    defaultValue?: unknown;
}

function extractZodDescriptions(): Record<string, ConfigMetadata> {
    const result: Record<string, ConfigMetadata> = {};

    // Get the shape of the Zod schema
    const shape = (UserConfigSchema as ZodObject<ZodRawShape>).shape;

    for (const [key, fieldSchema] of Object.entries(shape)) {
        const schema = fieldSchema;
        // Extract description from Zod schema
        const description = schema.description || `Configuration option: ${key}`;

        // Extract default value if present
        let defaultValue: unknown = undefined;
        if (schema._def && "defaultValue" in schema._def) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            defaultValue = schema._def.defaultValue() as unknown;
        }

        result[key] = {
            description,
            defaultValue,
        };
    }

    return result;
}

function parseOptionsFromConfig(): ParsedOptions {
    const configPath = join(__dirname, "..", "src", "common", "config.ts");
    const configContent = readFileSync(configPath, "utf-8");

    // Extract the OPTIONS object using regex
    const optionsMatch = configContent.match(/const OPTIONS = \{([\s\S]*?)\} as Readonly<Options>;/);

    if (!optionsMatch) {
        throw new Error("Could not find OPTIONS object in config.ts");
    }

    const optionsContent = optionsMatch[1];

    // Parse each array type
    const parseArray = (type: string): string[] => {
        const regex = new RegExp(`${type}:\\s*\\[(.*?)\\]`, "s");
        const match = optionsContent?.match(regex);
        if (!match) return [];

        // Extract quoted strings from the array
        const arrayContent = match[1];
        if (!arrayContent) return [];
        const items = arrayContent.match(/"([^"]+)"/g);
        return items ? items.map((item) => item.replace(/"/g, "")) : [];
    };

    // Parse alias object
    const parseAlias = (): Record<string, string> => {
        const aliasMatch = optionsContent?.match(/alias:\s*\{([\s\S]*?)\}/);
        if (!aliasMatch) return {};

        const aliasContent = aliasMatch[1];
        if (!aliasContent) return {};
        const entries = aliasContent.matchAll(/(\w+):\s*"([^"]+)"/g);
        const result: Record<string, string> = {};

        for (const match of entries) {
            if (match && match[1] && match[2]) {
                result[match[1]] = match[2];
            }
        }

        return result;
    };

    return {
        string: parseArray("string"),
        number: parseArray("number"),
        boolean: parseArray("boolean"),
        array: parseArray("array"),
        alias: parseAlias(),
    };
}

function generateEnvironmentVariables(
    options: ParsedOptions,
    zodMetadata: Record<string, ConfigMetadata>
): EnvironmentVariable[] {
    const envVars: EnvironmentVariable[] = [];
    const processedKeys = new Set<string>();

    // Helper to add env var
    const addEnvVar = (key: string, type: "string" | "number" | "boolean" | "array"): void => {
        if (processedKeys.has(key)) return;
        processedKeys.add(key);

        const envVarName = `MDB_MCP_${camelCaseToSnakeCase(key)}`;

        // Get description and default value from Zod metadata
        const metadata = zodMetadata[key] || {
            description: `Configuration option: ${key}`,
        };

        // Determine format based on type
        let format = type;
        if (type === "array") {
            format = "string"; // Arrays are passed as comma-separated strings
        }

        envVars.push({
            name: envVarName,
            description: metadata.description,
            isRequired: false,
            format: format,
            isSecret: SECRET_CONFIG_KEYS.has(key),
            configKey: key,
            defaultValue: metadata.defaultValue,
        });
    };

    // Process all string options
    for (const key of options.string) {
        addEnvVar(key, "string");
    }

    // Process all number options
    for (const key of options.number) {
        addEnvVar(key, "number");
    }

    // Process all boolean options
    for (const key of options.boolean) {
        addEnvVar(key, "boolean");
    }

    // Process all array options
    for (const key of options.array) {
        addEnvVar(key, "array");
    }

    // Sort by name for consistent output
    return envVars.sort((a, b) => a.name.localeCompare(b.name));
}

function generatePackageArguments(envVars: EnvironmentVariable[]): unknown[] {
    const packageArguments: unknown[] = [];

    // Generate positional arguments from the same config options (only documented ones)
    const documentedVars = envVars.filter((v) => !v.description.startsWith("Configuration option:"));

    for (const envVar of documentedVars) {
        const arg: Record<string, unknown> = {
            type: "positional",
            valueHint: envVar.configKey,
            description: envVar.description,
            isRequired: envVar.isRequired,
        };

        // Add format if it's not string (string is the default)
        if (envVar.format !== "string") {
            arg.format = envVar.format;
        }

        packageArguments.push(arg);
    }

    return packageArguments;
}

function updateServerJsonEnvVars(envVars: EnvironmentVariable[]): void {
    const serverJsonPath = join(__dirname, "..", "server.json");
    const packageJsonPath = join(__dirname, "..", "package.json");

    const content = readFileSync(serverJsonPath, "utf-8");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
    const serverJson = JSON.parse(content) as {
        version?: string;
        packages: { environmentVariables: EnvironmentVariable[]; packageArguments?: unknown[]; version?: string }[];
    };

    // Get version from package.json
    const version = packageJson.version;

    // Generate environment variables array (only documented ones)
    const documentedVars = envVars.filter((v) => !v.description.startsWith("Configuration option:"));
    const envVarsArray = documentedVars.map((v) => ({
        name: v.name,
        description: v.description,
        isRequired: v.isRequired,
        format: v.format,
        isSecret: v.isSecret,
    }));

    // Generate package arguments (positional arguments in camelCase)
    const packageArguments = generatePackageArguments(envVars);

    // Update version at root level
    serverJson.version = process.env.VERSION || version;

    // Update environmentVariables, packageArguments, and version for all packages
    if (serverJson.packages && Array.isArray(serverJson.packages)) {
        for (const pkg of serverJson.packages) {
            pkg.environmentVariables = envVarsArray as EnvironmentVariable[];
            pkg.packageArguments = packageArguments;
            pkg.version = version;

            // Update OCI identifier version tag if this is an OCI package
            if (pkg.registryType === "oci" && pkg.identifier) {
                // Replace the version tag in the OCI identifier (e.g., docker.io/mongodb/mongodb-mcp-server:1.0.0)
                pkg.identifier = pkg.identifier.replace(/:[^:]+$/, `:${version}`);
            }
        }
    }

    writeFileSync(serverJsonPath, JSON.stringify(serverJson, null, 2) + "\n", "utf-8");
    console.log(`✓ Updated server.json (version ${version})`);
}

function main(): void {
    const zodMetadata = extractZodDescriptions();
    const options = parseOptionsFromConfig();

    const envVars = generateEnvironmentVariables(options, zodMetadata);
    updateServerJsonEnvVars(envVars);
}

main();
