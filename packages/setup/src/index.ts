export { AI_TOOL_REGISTRY, type AIToolType } from "./aiTool.js";
export {
    buildSkillsAddArgs,
    installSkills,
    promptAndInstallSkills,
    type SkillsInstallOutcome,
} from "./installSkills.js";
export { runSetup } from "./setupMcpServer.js";
export { SetupTelemetry, type SetupTelemetryContext, toBoolSet } from "./setupTelemetry.js";
export { formatError, getPlatform, type Platform } from "./setupAiToolsUtils.js";
export { openConfigSettings, TOOLS_WITHOUT_EDITORS } from "./aiTool.js";
export type { SetupConfig, SetupPackageInfo } from "./types.js";
