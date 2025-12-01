import * as AtlasTools from "./atlas/tools.js";
import * as AtlasLocalTools from "./atlasLocal/tools.js";
import * as MongoDbTools from "./mongodb/tools.js";

const AllTools = {
    ...MongoDbTools,
    ...AtlasTools,
    ...AtlasLocalTools,
} as const;

// Export all the different categories of tools
export { AllTools, MongoDbTools, AtlasTools, AtlasLocalTools };

// Export the base tool class and supporting types.
export {
    ToolBase,
    type ToolClass,
    type ToolConstructorParams,
    type ToolCategory,
    type OperationType,
    type ToolArgs,
    type ToolExecutionContext,
} from "./tool.js";
