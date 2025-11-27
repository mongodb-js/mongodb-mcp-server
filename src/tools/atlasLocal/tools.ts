import { DeleteDeploymentTool } from "./delete/deleteDeployment.js";
import { ListDeploymentsTool } from "./read/listDeployments.js";
import { CreateDeploymentTool } from "./create/createDeployment.js";
import { ConnectDeploymentTool } from "./connect/connectDeployment.js";
import type { ToolClass } from "../tool.js";

export const AtlasLocalTools: ToolClass[] = [
    ListDeploymentsTool,
    DeleteDeploymentTool,
    CreateDeploymentTool,
    ConnectDeploymentTool,
];
