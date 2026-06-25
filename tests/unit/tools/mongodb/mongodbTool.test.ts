import { describe, it, expect } from "vitest";
import { z } from "zod";
import { MongoDBToolBase } from "../../../../src/tools/mongodb/mongodbTool.js";
import type { OperationType } from "../../../../src/tools/tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Session } from "../../../../src/common/session.js";
import type { UserConfig } from "../../../../src/common/config/userConfig.js";
import { MongoDBError, ErrorCodes } from "../../../../src/common/errors.js";
import { Keychain } from "../../../../src/common/keychain.js";
import type { TelemetryToolMetadata } from "../../../../src/telemetry/types.js";

class TestMongoDBTool extends MongoDBToolBase {
    public description = "test mongodb tool";
    public argsShape = { input: z.string() };
    protected execute(): Promise<CallToolResult> {
        return Promise.resolve({ content: [] });
    }
    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
    public callAssertMqlIsAllowed(value: Record<string, unknown> | Record<string, unknown>[] | undefined): void {
        this.assertMqlIsAllowed(value);
    }
    public callIsEffectivelyReadOnly(): boolean {
        return this.isEffectivelyReadOnly();
    }
}

function makeTool({
    connectionReadOnly,
    configReadOnly,
    operationType = "read",
}: {
    connectionReadOnly?: boolean;
    configReadOnly: boolean;
    operationType?: OperationType;
}): TestMongoDBTool {
    const session = {
        logger: { debug() {}, info() {}, warning() {}, error() {} },
        keychain: new Keychain(),
        connectionManager: {
            currentConnectionState: { tag: "connected", readOnly: connectionReadOnly },
        },
    } as unknown as Session;

    const config = {
        readOnly: configReadOnly,
        disabledTools: [],
        disableServerSideJs: false,
        confirmationRequiredTools: [],
        previewFeatures: [],
    } as unknown as UserConfig;

    return new TestMongoDBTool({
        name: "test-mongodb-tool",
        category: TestMongoDBTool.category,
        operationType,
        session,
        config,
        telemetry: { isTelemetryEnabled: () => false, emitEvents(): void {} } as never,
        elicitation: { requestConfirmation: () => Promise.resolve(true) } as never,
        metrics: { get: () => ({ observe(): void {} }) } as never,
    });
}

describe("MongoDBToolBase effective read-only", () => {
    it("reflects connection read-only even when config is writable", () => {
        expect(makeTool({ connectionReadOnly: true, configReadOnly: false }).callIsEffectivelyReadOnly()).toBe(true);
        expect(makeTool({ connectionReadOnly: false, configReadOnly: false }).callIsEffectivelyReadOnly()).toBe(false);
        expect(makeTool({ connectionReadOnly: undefined, configReadOnly: false }).callIsEffectivelyReadOnly()).toBe(
            false
        );
        expect(makeTool({ connectionReadOnly: false, configReadOnly: true }).callIsEffectivelyReadOnly()).toBe(true);
    });

    it("rejects $out pipelines on a read-only connection", () => {
        const tool = makeTool({ connectionReadOnly: true, configReadOnly: false });
        try {
            tool.callAssertMqlIsAllowed([{ $out: "outpeople" }]);
            throw new Error("expected assertMqlIsAllowed to throw");
        } catch (err) {
            expect(err).toBeInstanceOf(MongoDBError);
            expect((err as MongoDBError).code).toBe(ErrorCodes.ForbiddenWriteOperation);
            expect((err as Error).message).toContain(
                "In readOnly mode you can not run pipelines with $out or $merge stages."
            );
        }
    });

    it("allows $out pipelines on a writable connection", () => {
        expect(() =>
            makeTool({ connectionReadOnly: false, configReadOnly: false }).callAssertMqlIsAllowed([
                { $out: "outpeople" },
            ])
        ).not.toThrow();
    });

    it("rejects a write-operation tool at execution time when the connection is read-only", async () => {
        const tool = makeTool({ connectionReadOnly: true, configReadOnly: false, operationType: "delete" });
        const result = await tool.invoke(
            { input: "x" },
            { signal: new AbortController().signal, requestInfo: { headers: {} } }
        );
        expect(result.isError).toBe(true);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain("read-only");
        expect(text).toContain("delete");
    });

    it("allows a write-operation tool at execution time when the connection is writable", async () => {
        const tool = makeTool({ connectionReadOnly: false, configReadOnly: false, operationType: "delete" });
        const result = await tool.invoke(
            { input: "x" },
            { signal: new AbortController().signal, requestInfo: { headers: {} } }
        );
        expect(result.isError).toBeUndefined();
    });
});
