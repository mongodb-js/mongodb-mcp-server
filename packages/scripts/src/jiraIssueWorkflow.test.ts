import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type JiraExtraData = { fields: { customfield_12751: Array<{ id: string }> } };

function getCreateJiraExtraData(): JiraExtraData {
    const workflow = readFileSync(resolve(import.meta.dirname, "../../../.github/workflows/jira-issue.yml"), "utf8");
    const match = workflow.match(/extra-data: \|\n(?<json>(?: {12}.*\n)+)/);

    if (!match?.groups?.json) {
        throw new Error("Could not find create-jira extra-data JSON");
    }

    const json = match.groups.json
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(12))
        .join("\n");

    return JSON.parse(json) as JiraExtraData;
}

describe("jira issue workflow", () => {
    it("assigns created Jira issues only to MCP Developers", () => {
        expect(getCreateJiraExtraData().fields.customfield_12751).toEqual([{ id: "36259" }]);
    });
});
