export { createAtlasLocalClient, type AtlasLocalClientFactoryFn, type LibraryLoader } from "./atlasLocalClient.js";
export {
    AtlasLocalToolBase,
    type IAtlasLocalConfig,
    type AtlasLocalToolServices,
    type AtlasLocalToolServer,
    AtlasLocalToolMetadataDeploymentIdKey,
} from "./atlasLocalTool.js";
export type { Deployment } from "@mongodb-js/atlas-local";
export * from "./tools/tools.js";

import type { AtlasLocalToolServer } from "./atlasLocalTool.js";
import {
    CreateDeploymentTool,
    ListDeploymentsTool,
    DeleteDeploymentTool,
    ConnectDeploymentTool,
} from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";

export const AtlasLocalTools: ToolClass<AtlasLocalToolServer>[] = [
    CreateDeploymentTool,
    ListDeploymentsTool,
    DeleteDeploymentTool,
    ConnectDeploymentTool,
] as const;
