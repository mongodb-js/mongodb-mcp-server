import { CodexTuiHarness } from "./harness/codex/codexTui.js";
import { ClaudeTuiHarness } from "./harness/claude/claudeTui.js";
import type { AgentHarness } from "./harness/types.js";

export const AGENT_HARNESSES: readonly (new () => AgentHarness)[] = [CodexTuiHarness, ClaudeTuiHarness];
