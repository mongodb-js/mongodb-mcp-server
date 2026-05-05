export { createAtlasLocalClient, type AtlasLocalClientFactoryFn, type LibraryLoader } from "./atlasLocalClient.js";
export {
    AtlasLocalToolBase,
    type IAtlasLocalConfig,
    type IAtlasLocalSession,
    AtlasLocalToolMetadataDeploymentIdKey,
} from "./atlasLocalTool.js";
export * from "./tools/tools.js";

import * as tools from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";
export const AtlasLocalTools: ToolClass[] = Object.values(tools);
