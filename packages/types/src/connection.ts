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
