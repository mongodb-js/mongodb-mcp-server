#!/usr/bin/env tsx

/**
 * This script generates argument definitions and updates:
 * - server.json arrays
 * - README.md configuration table
 *
 * It uses the Zod schema and OPTIONS defined in src/common/config.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { UserConfigSchema, configRegistry } from "../src/common/config.js";
import assert from "assert";
import { execSync } from "child_process";
import { OPTIONS } from "../src/common/argsParserOptions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function camelCaseToSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}

// List of mongosh OPTIONS that contain sensitive/secret information
// These should be redacted in logs and marked as secret in environment variable definitions
const SECRET_OPTIONS_KEYS = new Set([
    "connectionString",
    "username",
    "password",
    "tlsCAFile",
    "tlsCertificateKeyFile",
    "tlsCertificateKeyFilePassword",
    "tlsCRLFile",
    "sslCAFile",
    "sslPEMKeyFile",
    "sslPEMKeyPassword",
    "sslCRLFile",
]);

interface ArgumentInfo {
    name: string;
    description: string;
    isRequired: boolean;
    format: string;
    isSecret: boolean;
    configKey: string;
    defaultValue?: unknown;
    defaultValueDescription?: string;
}

interface ConfigMetadata {
    description: string;
    defaultValue?: unknown;
    defaultValueDescription?: string;
    isSecret?: boolean;
}

function extractZodDescriptions(): Record<string, ConfigMetadata> {
    const result: Record<string, ConfigMetadata> = {};

    // Get the shape of the Zod schema
    const shape = UserConfigSchema.shape;

    for (const [key, fieldSchema] of Object.entries(shape)) {
        const schema = fieldSchema;
        // Extract description from Zod schema
        let description = schema.description || `Configuration option: ${key}`;

        if ("innerType" in schema.def) {
            // "pipe" is used for our comma-separated arrays
            if (schema.def.innerType.def.type === "pipe") {
                assert(
                    description.startsWith("An array of"),
                    `Field description for field "${key}" with array type does not start with 'An array of'`
                );
                description = description.replace("An array of", "Comma separated values of");
            }
        }

        // Extract default value if present
        let defaultValue: unknown = undefined;
        let defaultValueDescription: string | undefined = undefined;
        let isSecret: boolean | undefined = undefined;
        if (schema.def && "defaultValue" in schema.def) {
            defaultValue = schema.def.defaultValue;
        }
        // Get metadata from custom registry
        const registryMeta = configRegistry.get(schema);
        if (registryMeta) {
            defaultValueDescription = registryMeta.defaultValueDescription;
            isSecret = registryMeta.isSecret;
        }

        result[key] = {
            description,
            defaultValue,
            defaultValueDescription,
            isSecret,
        };
    }

    return result;
}

function getArgumentInfo(options: typeof OPTIONS, zodMetadata: Record<string, ConfigMetadata>): ArgumentInfo[] {
    const argumentInfos: ArgumentInfo[] = [];
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

        argumentInfos.push({
            name: envVarName,
            description: metadata.description,
            isRequired: false,
            format: format,
            isSecret: metadata.isSecret ?? SECRET_OPTIONS_KEYS.has(key),
            configKey: key,
            defaultValue: metadata.defaultValue,
            defaultValueDescription: metadata.defaultValueDescription,
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
    return argumentInfos.sort((a, b) => a.name.localeCompare(b.name));
}

function generatePackageArguments(envVars: ArgumentInfo[]): unknown[] {
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

function updateServerJsonEnvVars(envVars: ArgumentInfo[]): void {
    const serverJsonPath = join(__dirname, "..", "server.json");
    const packageJsonPath = join(__dirname, "..", "package.json");

    const content = readFileSync(serverJsonPath, "utf-8");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
    const serverJson = JSON.parse(content) as {
        version?: string;
        packages: {
            registryType?: string;
            identifier: string;
            environmentVariables: ArgumentInfo[];
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
            pkg.environmentVariables = envVarsArray as ArgumentInfo[];
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

function generateReadmeConfigTable(argumentInfos: ArgumentInfo[]): string {
    const rows = [
        "| CLI Option                             | Environment Variable                                | Default                                                                     | Description                                                                                                                                                                                             |",
        "| -------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |",
    ];

    // Filter to only include options that are in the Zod schema (documented options)
    const documentedVars = argumentInfos.filter((v) => !v.description.startsWith("Configuration option:"));

    for (const argumentInfo of documentedVars) {
        const cliOption = `\`${argumentInfo.configKey}\``;
        const envVarName = `\`${argumentInfo.name}\``;

        const defaultValue = argumentInfo.defaultValue;

        let defaultValueString = argumentInfo.defaultValueDescription ?? "`<not set>`";
        if (!argumentInfo.defaultValueDescription && defaultValue !== undefined && defaultValue !== null) {
            if (Array.isArray(defaultValue)) {
                defaultValueString = `\`"${defaultValue.join(",")}"\``;
            } else {
                // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
                switch (typeof defaultValue) {
                    case "number":
                        defaultValueString = `\`${defaultValue}\``;
                        break;
                    case "boolean":
                        defaultValueString = `\`${defaultValue}\``;
                        break;
                    case "string":
                        defaultValueString = `\`"${defaultValue}"\``;
                        break;
                    default:
                        throw new Error(`Unsupported default value type: ${typeof defaultValue}`);
                }
            }
        }

        const desc = argumentInfo.description.replace(/\|/g, "\\|"); // Escape pipes in description
        rows.push(
            `| ${cliOption.padEnd(38)} | ${envVarName.padEnd(51)} | ${defaultValueString.padEnd(75)} | ${desc.padEnd(199)} |`
        );
    }

    return rows.join("\n");
}

function updateReadmeConfigTable(envVars: ArgumentInfo[]): void {
    const readmePath = join(__dirname, "..", "README.md");
    let content = readFileSync(readmePath, "utf-8");

    const newTable = generateReadmeConfigTable(envVars);

    // Find and replace the configuration options table
    const tableRegex = /### Configuration Options\n\n\| CLI Option[\s\S]*?\n\n####/;
    const replacement = `### Configuration Options\n\n${newTable}\n\n####`;

    content = content.replace(tableRegex, replacement);

    writeFileSync(readmePath, content, "utf-8");
    console.log("✓ Updated README.md configuration table");

    // Run prettier on the README.md file
    execSync("npx prettier --write README.md", { cwd: join(__dirname, "..") });
}

function main(): void {
    const zodMetadata = extractZodDescriptions();

    const argumentInfo = getArgumentInfo(OPTIONS, zodMetadata);
    updateServerJsonEnvVars(argumentInfo);
    updateReadmeConfigTable(argumentInfo);
}

main();
