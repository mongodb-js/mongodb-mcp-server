import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { AI_TOOL_REGISTRY, type AIToolType } from "../../../src/setup/aiTool.js";
import { buildSkillsAddArgs } from "../../../src/setup/installSkills.js";

/**
 * Verifies every `AIToolType`'s `getSkillsAgentId()` returns a value the pinned
 * `skills` CLI actually accepts, by running a real install for each agent into
 * an isolated temp directory and asserting exit 0.
 *
 * Real subprocess + network: each test clones `mongodb/agent-skills` and runs
 * `npx skills@1 add ...`. The value is catching drift between our mapping and
 * the CLI's registry (e.g. if `skills` renames `github-copilot` in a minor
 * release).
 */
type Mapping = { toolType: AIToolType; agentId: string };

const MAPPINGS: Mapping[] = Object.entries(AI_TOOL_REGISTRY)
    .map(([toolType, tool]) => ({ toolType: toolType as AIToolType, agentId: tool.getSkillsAgentId() }))
    .filter((m): m is Mapping => m.agentId !== null);

describe("skills CLI agent ID mapping", () => {
    let tmpRoot: string;

    beforeAll(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdb-mcp-agent-id-check-"));
    });

    afterAll(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it.each(MAPPINGS)(
        "agent ID '$agentId' (tool '$toolType') is accepted by the pinned skills CLI",
        ({ agentId }) => {
            const safeName = agentId.replace(/[^a-z0-9]/gi, "-");
            const testCwd = fs.mkdtempSync(path.join(tmpRoot, `${safeName}-`));

            const args = buildSkillsAddArgs(agentId, false);
            const result = spawnSync("npx", args, {
                cwd: testCwd,
                encoding: "utf8",
                timeout: 180_000,
            });

            expect(
                result.status,
                `skills add --agent ${agentId} exited with ${result.status}.\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`
            ).toBe(0);
        },
        180_000
    );
});
