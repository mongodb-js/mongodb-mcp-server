import { isAtlas } from "mongodb-build-info";
import type { MongoClientOptions } from "mongodb";
import { ConnectionString } from "mongodb-connection-string-url";
import type { AtlasClusterConnectionInfo } from "@mongodb-js/mcp-types";
export type { AtlasClusterConnectionInfo };

/**
 * Minimum fields needed for OIDC auth-type inference when resolving connection metadata.
 * Callers may pass a superset (e.g. full `UserConfig`) as long as these are present.
 */
export interface ConnectionInfo {
    transport: "stdio" | "http";
    httpHost: string;
    browser?: string | false;
}

/**
 * The host type of the connection string. Some values (e.g. local) are not yet supported, tools mostly
 * will return "unknown" for these values.
 */
export type ConnectionStringHostType = "local" | "atlas" | "atlas_local" | "unknown";

export type OIDCConnectionAuthType = "oidc-auth-flow" | "oidc-device-flow";
export type ConnectionStringAuthType = "scram" | "ldap" | "kerberos" | OIDCConnectionAuthType | "x.509";

/**
 * ConnectionStringInfo contains connection string metadata
 * without keeping the full connection string.
 */
export interface ConnectionStringInfo {
    authType: ConnectionStringAuthType;
    hostType: ConnectionStringHostType;
}

/**
 * Get metadata about the connection string including authentication type and host type.
 * @param connectionString - The connection string to analyze.
 * @param connectionInfo - Transport / browser hints used to determine auth type.
 * @param atlasInfo - Optional Atlas cluster connection info. If provided, host type is set to "atlas".
 * @returns The connection string metadata.
 */
export function getConnectionStringInfo(
    connectionString: string,
    connectionInfo: ConnectionInfo,
    atlasInfo?: AtlasClusterConnectionInfo
): ConnectionStringInfo {
    return {
        authType: getAuthType(connectionInfo, connectionString),
        hostType: atlasInfo !== undefined ? "atlas" : getHostType(connectionString),
    };
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
 * Infer the authentication type from the connection string and options.
 * @param connectionInfo - Transport / browser hints.
 * @param connectionString - The connection string to infer the auth type from.
 * @returns The inferred authentication type.
 */
export function getAuthType(connectionInfo: ConnectionInfo, connectionString: string): ConnectionStringAuthType {
    const connString = new ConnectionString(connectionString);
    const searchParams = connString.typedSearchParams<MongoClientOptions>();

    switch (searchParams.get("authMechanism")) {
        case "MONGODB-OIDC": {
            if (connectionInfo.transport === "stdio" && connectionInfo.browser) {
                return "oidc-auth-flow";
            }

            if (
                connectionInfo.transport === "http" &&
                (connectionInfo.httpHost === "127.0.0.1" || connectionInfo.httpHost === "localhost") &&
                connectionInfo.browser
            ) {
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
