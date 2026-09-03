import { isAtlas, isLocalhost } from "mongodb-build-info";
import type { MongoClientOptions } from "mongodb";
import { ConnectionString } from "mongodb-connection-string-url";
import type { UserConfig } from "./config/userConfig.js";

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
 * Atlas cluster connection info containing details about the connected Atlas cluster.
 * When provided, indicates the connection is to an Atlas cluster.
 *
 * The cluster's projectId, name and id are required. A host that establishes the
 * connection without minting a temporary database user — via its own credential
 * issuance, X.509, a pre-provisioned user, a proxy — still knows which cluster it
 * connected to and needs to be able to specify it: this field is what marks a
 * connection as pointing at Atlas, and leaving it unset prevents cluster
 * attribution on tool telemetry, the `atlas` host type, and the ability of
 * `pause-resume-cluster` to find connections to the cluster it just paused.
 * Hosts that only know the cluster name should resolve the id through the Atlas
 * API before connecting.
 */
export interface AtlasClusterConnectionInfo {
    /** Which Atlas cluster this connection points at. */
    projectId: string;
    clusterName: string;
    clusterId: string;

    /**
     * The temporary database user backing the connection. Set only by
     * `connect-cluster`, which also schedules its deletion; absent when the
     * host supplied its own credentials.
     */
    username?: string;

    /** The cluster's tier, set when the host resolved it. */
    instanceType?: "FREE" | "FLEX" | "DEDICATED";
}

/**
 * Get metadata about the connection string including authentication type and host type.
 * @param connectionString - The connection string to analyze.
 * @param config - The user configuration used to determine auth type.
 * @param atlasInfo - Optional Atlas cluster connection info. If provided, host type is set to "atlas".
 * @returns The connection string metadata.
 */
export function getConnectionStringInfo(
    connectionString: string,
    config: UserConfig,
    atlasInfo?: AtlasClusterConnectionInfo
): ConnectionStringInfo {
    return {
        authType: getAuthType(config, connectionString),
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

    if (isLocalhost(connectionString)) {
        return "local";
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

            if (
                config.transport === "http" &&
                (config.httpHost === "127.0.0.1" || config.httpHost === "localhost") &&
                config.browser
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
