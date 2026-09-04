import { ClaudeTuiHarness } from "./harness/claude/claudeHarness.js";
import { CodexTuiHarness } from "./harness/codex/codexHarness.js";

export { useAgent, type AgentContext } from "./useAgent.js";
export { AGENT_HARNESSES } from "./harnesses.js";
export type {
    AgentConfirmation,
    AgentHarness,
    AgentHarnessConfig,
    AgentHarnessOptions,
    AgentSession,
    AgentTurn,
    ConfirmationResponder,
    PromptOptions,
    ToolCallRecord,
} from "./harness/types.js";
export { ClaudeTuiHarness, CodexTuiHarness };
