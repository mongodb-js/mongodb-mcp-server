import { Keychain, type Secret } from "@mongodb-js/mcp-core";
import type { UserConfig } from "./userConfig.js";

/**
 * Builds the server's redaction keychain from the fixed, config-derived
 * secrets. The keychain is immutable: every secret it will ever hold is known
 * here, at config time, and no runtime code may add secrets to it (temporary
 * database users and per-request connection strings are kept out of emitted
 * strings by construction instead). One keychain instance is created per server
 * and threaded through the loggers, services and tools; a scoped copy can be
 * derived with {@link Keychain.extended}.
 */
export function createKeychainFromConfig(userConfig: Partial<UserConfig>): Keychain {
    const secrets: Secret[] = [];

    const add = (value: string | undefined, kind: Secret["kind"]): void => {
        if (value) {
            secrets.push({ value, kind });
        }
    };

    add(userConfig.apiClientId, "user");
    add(userConfig.apiClientSecret, "password");
    add(userConfig.awsAccessKeyId, "password");
    add(userConfig.awsIamSessionToken, "password");
    add(userConfig.awsSecretAccessKey, "password");
    add(userConfig.awsSessionToken, "password");
    add(userConfig.password, "password");
    add(userConfig.tlsCAFile, "url");
    add(userConfig.tlsCRLFile, "url");
    add(userConfig.tlsCertificateKeyFile, "url");
    add(userConfig.tlsCertificateKeyFilePassword, "password");
    add(userConfig.username, "user");
    add(userConfig.voyageApiKey, "password");
    add(userConfig.connectionString, "mongodb uri");

    return new Keychain(secrets);
}
