import { ConnectClusterTool } from "./metadata/connectCluster.js";
import { CreateClusterTool } from "./create/createCluster.js";
import { DeleteClusterTool } from "./delete/deleteCluster.js";
import { InspectClusterTool } from "./read/inspectCluster.js";
import { ListClustersTool } from "./read/listClusters.js";

export const LocalTools = [
    ConnectClusterTool,
    CreateClusterTool,
    DeleteClusterTool,
    InspectClusterTool,
    ListClustersTool,
];
