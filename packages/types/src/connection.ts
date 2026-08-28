/**
 * Atlas cluster connection info containing details about the connected Atlas cluster.
 * When provided, indicates the connection is to an Atlas cluster.
 *
 * Only the cluster's projectId + name are required, because they are all a host is
 * guaranteed to know. A host that establishes the connection without minting a
 * temporary database user — via its own credential issuance, X.509, a
 * pre-provisioned user, a proxy — still knows which cluster it connected to and
 * needs to be able to specify it: this field is what marks a connection as
 * pointing at Atlas, and leaving it unset prevents project attribution on tool
 * telemetry, the `atlas` host type, and the ability of `pause-resume-cluster`
 * to find connections to the cluster it just paused.
 */
export type AtlasClusterConnectionInfo = {
    /** Which Atlas cluster this connection points at. Always known. */
    projectId: string;
    clusterName: string;

    /**
     * The temporary database user backing the connection. Set only by
     * `connect-cluster`, which also schedules its deletion; absent when the
     * host supplied its own credentials.
     */
    username?: string;

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
    connectedAtlasCluster?: AtlasClusterConnectionInfo;
};
