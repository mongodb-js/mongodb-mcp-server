import { describe, it, expect, vi } from "vitest";

import { FindTool } from "../tools/read/find.js";
import type { MongoDBToolServer, IMongoDBConfig } from "../mongodbTool.js";
import type { ITelemetry } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { MockMetrics, createMockElicitation } from "@mongodb-js/mcp-test-utils";

// assertMqlIsAllowed only reads config, so a minimally-constructed MongoDB tool is enough to exercise it.
function makeTool(config: Partial<IMongoDBConfig>): (...values: unknown[]) => void {
    const mockLogger = {
        info: vi.fn(),
        debug: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    } as unknown as CompositeLogger;

    const server: MongoDBToolServer = {
        config: {
            disableServerSideJs: true,
            readOnly: false,
            disabledTools: [],
            confirmationRequiredTools: [],
            previewFeatures: [],
            ...config,
        } as unknown as IMongoDBConfig,
        logger: mockLogger,
        keychain: { redact: (value: unknown) => value } as never,
        connectionRegistry: {} as never,
        connectionErrorHandler: (() => ({ errorHandled: false, result: undefined })) as never,
        exportsManager: { createJSONExport: vi.fn() },
        telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as ITelemetry,
        elicitation: createMockElicitation(),
        metrics: new MockMetrics(),
        uiRegistry: { get: vi.fn().mockResolvedValue(null) },
    } as unknown as MongoDBToolServer;

    const tool = new FindTool({ server }) as unknown as {
        assertMqlIsAllowed: (config: IMongoDBConfig, ...values: unknown[]) => void;
    };
    const toolConfig = server.config;
    return (...values: unknown[]) => tool.assertMqlIsAllowed(toolConfig, ...values);
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
