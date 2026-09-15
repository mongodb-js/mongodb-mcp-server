import { Keychain, type SecretKind } from "@mongodb-js/mcp-core";
import type { UserConfig } from "./userConfig.js";

/**
 * Builds the server's redaction keychain from the fixed, config-derived
 * secrets. The keychain is immutable: every secret it will ever hold is known
 * here, at config time, and no runtime code may add secrets to it (temporary
 * database users and per-request connection strings are kept out of emitted
 * strings by construction instead). One keychain instance is created per server
 * and threaded through the loggers, services and tools.
 */
export function createKeychainFromConfig(userConfig: Partial<UserConfig>): Keychain {
    const secrets: Record<string, SecretKind> = {};

    if (userConfig.apiClientId) secrets[userConfig.apiClientId] = "user";
    if (userConfig.apiClientSecret) secrets[userConfig.apiClientSecret] = "password";
    if (userConfig.awsAccessKeyId) secrets[userConfig.awsAccessKeyId] = "password";
    if (userConfig.awsIamSessionToken) secrets[userConfig.awsIamSessionToken] = "password";
    if (userConfig.awsSecretAccessKey) secrets[userConfig.awsSecretAccessKey] = "password";
    if (userConfig.awsSessionToken) secrets[userConfig.awsSessionToken] = "password";
    if (userConfig.password) secrets[userConfig.password] = "password";
    if (userConfig.tlsCAFile) secrets[userConfig.tlsCAFile] = "url";
    if (userConfig.tlsCRLFile) secrets[userConfig.tlsCRLFile] = "url";
    if (userConfig.tlsCertificateKeyFile) secrets[userConfig.tlsCertificateKeyFile] = "url";
    if (userConfig.tlsCertificateKeyFilePassword) secrets[userConfig.tlsCertificateKeyFilePassword] = "password";
    if (userConfig.username) secrets[userConfig.username] = "user";
    if (userConfig.voyageApiKey) secrets[userConfig.voyageApiKey] = "password";
    if (userConfig.connectionString) secrets[userConfig.connectionString] = "mongodb uri";

    return new Keychain(secrets);
}
