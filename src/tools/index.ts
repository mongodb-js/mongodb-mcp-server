import { AtlasTools } from "./atlas/tools.js";
import { AtlasLocalTools } from "./atlasLocal/tools.js";
import { MongoDbTools } from "./mongodb/tools.js";

const AllTools = [...MongoDbTools, ...AtlasTools, ...AtlasLocalTools];

export { AllTools, MongoDbTools, AtlasTools, AtlasLocalTools };

export {
    ToolBase,
    type ToolConstructorParams,
    type ToolCategory,
    type OperationType,
    type ToolArgs,
    type ToolExecutionContext,
} from "./tool.js";
