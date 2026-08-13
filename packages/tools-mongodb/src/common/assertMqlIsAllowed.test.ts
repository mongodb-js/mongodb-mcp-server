import { describe, it, expect, vi } from "vitest";
import type { ToolConstructorParams } from "../../../../src/tools/tool.js";
import { FindTool } from "../../../../src/tools/mongodb/read/find.js";
import type { Session } from "../../../../src/common/session.js";
import type { UserConfig } from "../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../src/common/logging/index.js";
import { UIRegistry } from "../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../mocks/metrics.js";

// assertMqlIsAllowed only reads config, so a minimally-constructed MongoDB tool is enough to exercise it.
function makeTool(config: Partial<UserConfig>): (...values: unknown[]) => void {
    const mockLogger = {
        info: vi.fn(),
        debug: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    } as unknown as CompositeLogger;

    const params: ToolConstructorParams = {
        name: FindTool.toolName,
        category: "mongodb",
        operationType: FindTool.operationType,
        session: { logger: mockLogger } as unknown as Session,
        config: {
            disableServerSideJs: true,
            readOnly: false,
            disabledTools: [],
            confirmationRequiredTools: [],
            previewFeatures: [],
            ...config,
        } as unknown as UserConfig,
        telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as Telemetry,
        elicitation: { requestConfirmation: vi.fn() } as unknown as Elicitation,
        metrics: new MockMetrics(),
        uiRegistry: new UIRegistry(),
    };

    const tool = new FindTool(params) as unknown as { assertMqlIsAllowed: (...values: unknown[]) => void };
    return (...values: unknown[]) => tool.assertMqlIsAllowed(...values);
}

const jsProjection = { computed: { $function: { body: "function() { return 1; }", args: [], lang: "js" } } };

describe("assertMqlIsAllowed", () => {
    describe("with disableServerSideJs enabled", () => {
        it("rejects a server-side JS operator found in any of the passed fragments", () => {
            const assert = makeTool({ disableServerSideJs: true });
            expect(() => assert({ age: { $gt: 8 } }, jsProjection)).toThrow(/\$function/);
        });

        it("does not reject when no fragment contains a server-side JS operator", () => {
            const assert = makeTool({ disableServerSideJs: true });
            expect(() => assert({ age: { $gt: 8 } }, { name: 1 })).not.toThrow();
        });

        it("tolerates undefined fragments", () => {
            const assert = makeTool({ disableServerSideJs: true });
            expect(() => assert(undefined, { name: 1 })).not.toThrow();
        });
    });

    describe("with disableServerSideJs disabled", () => {
        it("allows a server-side JS operator in any fragment", () => {
            const assert = makeTool({ disableServerSideJs: false });
            expect(() => assert({}, jsProjection)).not.toThrow();
        });
    });

    describe("write-stage checks still apply per fragment", () => {
        it("rejects a pipeline containing a write stage in readOnly mode", () => {
            const assert = makeTool({ readOnly: true });
            expect(() => assert([{ $out: "leaked" }])).toThrow(/\$out or \$merge/);
        });

        it("allows a pipeline without write stages", () => {
            const assert = makeTool({ readOnly: true });
            expect(() => assert([{ $match: { age: { $gt: 8 } } }])).not.toThrow();
        });
    });
});
