import { AtlasTools } from "@mongodb-js/mcp-tools-atlas";
import { AtlasLocalTools } from "@mongodb-js/mcp-tools-atlas-local";
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
import { AssistantTools } from "@mongodb-js/mcp-tools-assistant";
import type { ToolClass } from "@mongodb-js/mcp-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AllTools: ToolClass<any>[] = [
    ...MongoDBTools,
    ...AtlasTools,
    ...AtlasLocalTools,
    ...AssistantTools,
] as const;
