import type { ResourceClass } from "@mongodb-js/mcp-api";

/**
 * The set of built-in resources that the server registers by default.
 *
 * Concrete resource implementations (`ConfigResource`, `DebugResource`,
 * `ExportedData`) live alongside the binary today. They will be moved into
 * dedicated packages in a future migration step. For now `mcp-core` exposes
 * an empty list as the default; callers can supply their own resources.
 */
export const Resources: ReadonlyArray<ResourceClass> = [] as const;
