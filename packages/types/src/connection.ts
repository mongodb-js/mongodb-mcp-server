/**
 * The Atlas cluster a connection entry addresses. Supplying it when creating the
 * entry marks the connection as an Atlas one: it drives cluster attribution on
 * tool telemetry, the `atlas` host type, and lets `pause-resume-cluster` find
 * the connections to the cluster it just paused. A host that establishes the
 * connection with its own credentials (X.509, a pre-provisioned user, a proxy)
 * still knows which cluster it connected to and should supply this.
 *
 * `clusterId` should be resolved through the Atlas API before connecting; it is
 * optional only because a registry can know which cluster a handle addresses
 * before the handle has dialed and resolved the id.
 */
export type AtlasClusterConnectionInfo = {
    projectId: string;
    clusterName: string;
    clusterId?: string;

    /** The cluster's tier, set when the host resolved it. */
    instanceType?: "FREE" | "FLEX" | "DEDICATED";
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
};
