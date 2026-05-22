export { createAtlasLocalClient, type AtlasLocalClientFactoryFn, type LibraryLoader } from "./atlasLocalClient.js";
export {
    AtlasLocalToolBase,
    type IAtlasLocalConfig,
    type IAtlasLocalSession,
    AtlasLocalToolMetadataDeploymentIdKey,
} from "./atlasLocalTool.js";
export * from "./tools/tools.js";

import type { IAtlasLocalSession } from "./atlasLocalTool.js";
import {
    CreateDeploymentTool,
    ListDeploymentsTool,
    DeleteDeploymentTool,
    ConnectDeploymentTool,
} from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";

export const AtlasLocalTools: ToolClass<IAtlasLocalSession>[] = [
    CreateDeploymentTool,
    ListDeploymentsTool,
    DeleteDeploymentTool,
    ConnectDeploymentTool,
] as const;
