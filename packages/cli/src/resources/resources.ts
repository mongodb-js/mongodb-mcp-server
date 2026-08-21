import type { AnyResourceClass } from "@mongodb-js/mcp-types";
import { ConfigResource } from "./common/config.js";
import { DebugResource } from "./common/debug.js";
import { ExportedData } from "./common/exportedData.js";

export { ConfigResource } from "./common/config.js";
export { DebugResource } from "./common/debug.js";
export { ExportedData } from "./common/exportedData.js";

export const Resources: AnyResourceClass[] = [ConfigResource, DebugResource, ExportedData];
