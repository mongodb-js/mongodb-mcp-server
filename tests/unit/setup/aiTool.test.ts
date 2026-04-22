import { describe, it, expect } from "vitest";
import { AI_TOOL_REGISTRY } from "../../../src/setup/aiTool.js";

describe("AITool.getSkillsAgentId", () => {
    it("returns 'cursor' for Cursor", () => {
        expect(AI_TOOL_REGISTRY.cursor.getSkillsAgentId()).toBe("cursor");
    });

    it("returns 'github-copilot' for VS Code", () => {
        expect(AI_TOOL_REGISTRY.vscode.getSkillsAgentId()).toBe("github-copilot");
    });

    it("returns 'claude-code' for Claude Code", () => {
        expect(AI_TOOL_REGISTRY.claudeCode.getSkillsAgentId()).toBe("claude-code");
    });

    it("returns 'windsurf' for Windsurf", () => {
        expect(AI_TOOL_REGISTRY.windsurf.getSkillsAgentId()).toBe("windsurf");
    });

    it("returns 'opencode' for OpenCode", () => {
        expect(AI_TOOL_REGISTRY.opencode.getSkillsAgentId()).toBe("opencode");
    });

    it("returns null for Claude Desktop (no filesystem skills)", () => {
        expect(AI_TOOL_REGISTRY.claudeDesktop.getSkillsAgentId()).toBeNull();
    });
});
