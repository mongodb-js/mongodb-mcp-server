import type { ResourceClass } from "@mongodb-js/mcp-core";
import { ConfigResource } from "./common/config.js";
import { DebugResource } from "./common/debug.js";
import { ExportedData } from "./common/exportedData.js";

export { ConfigResource } from "./common/config.js";
export { DebugResource } from "./common/debug.js";
export { ExportedData } from "./common/exportedData.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Resources: readonly ResourceClass<any>[] = [ConfigResource, DebugResource, ExportedData] as const;
