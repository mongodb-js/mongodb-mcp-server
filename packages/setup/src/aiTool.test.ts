import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Keychain } from "@mongodb-js/mcp-core";
import { AI_TOOL_REGISTRY, type AIToolType } from "./aiTool.js";

const keychain = { redactErrorMessage: (e: unknown) => String(e) } as unknown as Keychain;

describe("AITool.updateConfig readOnly flag", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitool-test-"));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const getArgs = (tool: AIToolType, content: Record<string, unknown>): string[] => {
        const key = tool === "vscode" ? "servers" : tool === "opencode" ? "mcp" : "mcpServers";
        const entry = (content[key] as Record<string, { args?: string[]; command: string | string[] }>)[
            "mongodb-mcp-server"
        ]!;
        return Array.isArray(entry.command) ? entry.command : entry.args!;
    };

    for (const tool of Object.keys(AI_TOOL_REGISTRY) as AIToolType[]) {
        for (const isReadOnly of [true, false]) {
            it(`${tool}: ${isReadOnly ? "includes" : "omits"} --readOnly (new file)`, () => {
                const configPath = path.join(tmpDir, "config.json");
                AI_TOOL_REGISTRY[tool].updateConfig({ configPath, env: {}, isReadOnly, keychain });
                const args = getArgs(tool, JSON.parse(fs.readFileSync(configPath, "utf-8")));
                expect(args.includes("--readOnly")).toBe(isReadOnly);
            });
        }

        it(`${tool}: adds --readOnly when patching an existing config`, () => {
            const configPath = path.join(tmpDir, "config.json");
            AI_TOOL_REGISTRY[tool].updateConfig({ configPath, env: {}, isReadOnly: false, keychain });
            AI_TOOL_REGISTRY[tool].updateConfig({ configPath, env: {}, isReadOnly: true, keychain });
            const args = getArgs(tool, JSON.parse(fs.readFileSync(configPath, "utf-8")));
            expect(args).toContain("--readOnly");
        });
    }
});
