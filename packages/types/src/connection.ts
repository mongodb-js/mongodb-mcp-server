/**
 * Atlas cluster connection info containing details about the connected Atlas cluster.
 * When provided, indicates the connection is to an Atlas cluster.
 */
export type AtlasClusterConnectionInfo = {
    username: string;
    projectId: string;
    clusterName: string;
    instanceType: "FREE" | "FLEX" | "DEDICATED";
    provider?: string;
    region?: string;
    expiryDate: Date;
};

/**
 * Connection string info describing the auth and host type of a MongoDB connection.
 */
export type ConnectionStringInfo = {
    authType: "scram" | "ldap" | "kerberos" | "oidc-auth-flow" | "oidc-device-flow" | "x.509" | "unknown";
    hostType: "unknown" | "atlas" | "local" | "atlas_local" | "other";
};

/**
 * Structural subset of a MongoDB connection's state used by tool telemetry
 * (kept dependency-free in mcp-types so core can describe it without
 * importing the tools-mongodb connection model).
 */
export type SupportedConnectionState = {
    tag: string;
    connectionStringInfo?: ConnectionStringInfo;
    connectedAtlasCluster?: AtlasClusterConnectionInfo;
};
