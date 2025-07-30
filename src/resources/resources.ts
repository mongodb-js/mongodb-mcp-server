import { ConfigResource } from "./common/config.js";
import { DebugResource } from "./common/debug.js";

export const Resources = [ConfigResource, DebugResource] as const;
