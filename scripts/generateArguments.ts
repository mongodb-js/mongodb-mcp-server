#!/usr/bin/env tsx

/**
 * This script generates argument definitions and updates:
 * - server.json arrays
 * - TODO: README.md configuration table
 *
 * It uses the Zod schema and OPTIONS defined in src/common/config.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { OPTIONS, UserConfigSchema } from "../src/common/config.js";
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
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            defaultValue = schema._def.defaultValue() as unknown;
        }

        result[key] = {
            description,
            defaultValue,
        };
    }

    return result;
}

function generateEnvironmentVariables(
    options: typeof OPTIONS,
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

    // Generate named arguments from the same config options
    for (const argument of documentedVars) {
        const arg: Record<string, unknown> = {
            type: "named",
            name: "--" + argument.configKey,
            description: argument.description,
            isRequired: argument.isRequired,
        };

        // Add format if it's not string (string is the default)
        if (argument.format !== "string") {
            arg.format = argument.format;
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
        packages: {
            registryType?: string;
            identifier: string;
            environmentVariables: EnvironmentVariable[];
            packageArguments?: unknown[];
            version?: string;
        }[];
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

    // Generate package arguments (named arguments in camelCase)
    const packageArguments = generatePackageArguments(envVars);

    // Update version at root level
    serverJson.version = process.env.VERSION || version;

    // Update environmentVariables, packageArguments, and version for all packages
    if (serverJson.packages && Array.isArray(serverJson.packages)) {
        for (const pkg of serverJson.packages) {
            pkg.environmentVariables = envVarsArray as EnvironmentVariable[];
            pkg.packageArguments = packageArguments;

            // For OCI packages, update the version tag in the identifier and not a version field
            if (pkg.registryType === "oci") {
                // Replace the version tag in the OCI identifier (e.g., docker.io/mongodb/mongodb-mcp-server:1.0.0)
                pkg.identifier = pkg.identifier.replace(/:[^:]+$/, `:${version}`);
            } else {
                pkg.version = version;
            }
        }
    }

    writeFileSync(serverJsonPath, JSON.stringify(serverJson, null, 2) + "\n", "utf-8");
    console.log(`✓ Updated server.json (version ${version})`);
}

function main(): void {
    const zodMetadata = extractZodDescriptions();

    const envVars = generateEnvironmentVariables(OPTIONS, zodMetadata);
    updateServerJsonEnvVars(envVars);
}

main();
