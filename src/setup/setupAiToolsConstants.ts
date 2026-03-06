export type AiToolType = "cursor" | "vscode" | "windsurf" | "claudeDesktop" | "claudeCode" | "codex" | "opencode";

export const AI_TOOLS = {
    CURSOR: "cursor",
    VSCODE: "vscode",
    WINDSURF: "windsurf",
    CLAUDE_DESKTOP: "claudeDesktop",
    CLAUDE_CODE: "claudeCode",
    CODEX: "codex",
    OPENCODE: "opencode",
} as const satisfies Record<string, AiToolType>;
