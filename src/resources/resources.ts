import { ConfigResource } from "./common/config.js";
import { DebugResource } from "./common/debug.js";
import { ExportedData } from "./common/exported-data.js";

export const Resources = [ConfigResource, DebugResource, ExportedData] as const;
