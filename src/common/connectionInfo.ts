import { isAtlas } from "mongodb-build-info";
import type { MongoClientOptions } from "mongodb";
import { ConnectionString } from "mongodb-connection-string-url";
import type { UserConfig } from "./config/userConfig.js";

/**
 * The host type of the connection string. Some values (e.g. local) are not yet supported, tools mostly
 * will return "unknown" for these values.
 */
export type ConnectionStringHostType = "local" | "atlas" | "atlas_local" | "unknown";

type OIDCConnectionAuthType = "oidc-auth-flow" | "oidc-device-flow";
export type ConnectionStringAuthType = "scram" | "ldap" | "kerberos" | OIDCConnectionAuthType | "x.509";

// ConnectionStringInfo is a simple object that contains metadata about the connection string
// without keeping the full connection string.
export interface ConnectionStringInfo {
    authType: ConnectionStringAuthType;
    hostType: ConnectionStringHostType;
}

/**
 * Get the host type from the connection string.
 * @param connectionString - The connection string to get the host type from.
 * @returns The host type.
 */
export function getHostType(connectionString: string): ConnectionStringHostType {
    if (isAtlas(connectionString)) {
        return "atlas";
    }
    return "unknown";
}

/**
 * Infer the authentication type from the connection string and user configuration.
 * @param config - The user configuration.
 * @param connectionString - The connection string to infer the auth type from.
 * @returns The inferred authentication type.
 */
export function getAuthType(config: UserConfig, connectionString: string): ConnectionStringAuthType {
    const connString = new ConnectionString(connectionString);
    const searchParams = connString.typedSearchParams<MongoClientOptions>();

    switch (searchParams.get("authMechanism")) {
        case "MONGODB-OIDC": {
            if (config.transport === "stdio" && config.browser) {
                return "oidc-auth-flow";
            }

            if (config.transport === "http" && config.httpHost === "127.0.0.1" && config.browser) {
                return "oidc-auth-flow";
            }

            return "oidc-device-flow";
        }
        case "MONGODB-X509":
            return "x.509";
        case "GSSAPI":
            return "kerberos";
        case "PLAIN":
            if (searchParams.get("authSource") === "$external") {
                return "ldap";
            }
            return "scram";
        // default should catch also null, but eslint complains
        // about it.
        case null:
        default:
            return "scram";
    }
}
