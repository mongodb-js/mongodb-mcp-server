import { describe, it, expect } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { SearchStageRulesTool, searchStageRules } from "../../../../../src/tools/mongodb/reference/searchStageRules.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

describe("SearchStageRulesTool", () => {
    function makeTool(): SearchStageRulesTool {
        const params: ToolConstructorParams = {
            name: SearchStageRulesTool.toolName,
            category: "mongodb",
            operationType: SearchStageRulesTool.operationType,
            session: {} as Session,
            config: {} as UserConfig,
            telemetry: {} as Telemetry,
            elicitation: {} as Elicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };
        return new SearchStageRulesTool(params);
    }

    it("returns the static search stage rules text", async () => {
        const tool = makeTool();
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        const exec = () => tool["execute"]();

        const result = await exec();

        expect(result.content).toHaveLength(1);
        expect(result.content[0]).toMatchObject({ type: "text", text: searchStageRules });
    });

    it("has no required parameters", () => {
        const tool = makeTool();
        expect(Object.keys(tool.argsShape)).toHaveLength(0);
    });
});
