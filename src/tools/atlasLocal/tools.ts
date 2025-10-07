import { DeleteDeploymentTool } from "./delete/deleteDeployment.js";
import { ListDeploymentsTool } from "./read/listDeployments.js";
import { CreateDeploymentTool } from "./create/createDeployment.js";
import { ConnectDeploymentTool } from "./connect/connectDeployment.js";

export const AtlasLocalTools = [ListDeploymentsTool, DeleteDeploymentTool, CreateDeploymentTool, ConnectDeploymentTool];
