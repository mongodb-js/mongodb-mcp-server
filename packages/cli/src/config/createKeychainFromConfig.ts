import { Keychain, type SecretKind } from "@mongodb-js/mcp-core";
import type { UserConfig } from "./userConfig.js";

export type CreateKeychainFromConfigOptions = {
    /** The parsed user config whose secret-bearing fields are registered. */
    config: Partial<UserConfig>;
    /**
     * Additional secrets to redact, merged on top of the config secrets (the
     * config value wins on a key collision). Useful for construction-time
     * secrets an embedder knows up front; there is no runtime register.
     */
    additionalSecrets?: Record<string, SecretKind>;
};

/**
 * Builds the server's redaction keychain from the fixed, config-derived
 * secrets, plus any {@link CreateKeychainFromConfigOptions.additionalSecrets}.
 * The keychain is immutable: every secret it will ever hold is known at
 * construction, and no runtime code may add secrets to it (temporary database
 * users and per-request connection strings are kept out of emitted strings by
 * construction instead). One keychain instance is created per server and
 * threaded through the loggers, services and tools.
 */
export function createKeychainFromConfig({
    config: userConfig,
    additionalSecrets = {},
}: CreateKeychainFromConfigOptions): Keychain {
    const secrets: Record<string, SecretKind> = { ...additionalSecrets };

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
