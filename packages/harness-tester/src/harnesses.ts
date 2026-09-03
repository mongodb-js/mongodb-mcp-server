import { CodexTuiHarness } from "./harness/codex/codexHarness.js";
import { ClaudeTuiHarness } from "./harness/claude/claudeHarness.js";
import type { AgentHarness } from "./harness/types.js";

export const AGENT_HARNESSES: readonly (new () => AgentHarness)[] = [CodexTuiHarness, ClaudeTuiHarness];
