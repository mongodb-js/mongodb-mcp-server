import { describe, it, expect } from "vitest";
import { toToolExecutionContext } from "./toolBase.js";
import type { ServerContext } from "@modelcontextprotocol/server";

function makeCtx(overrides: Partial<ServerContext> = {}): ServerContext {
    return {
        mcpReq: {
            // Filled below per-test; cast through Partial to allow partial fakes.
        },
        ...overrides,
    } as unknown as ServerContext;
}

describe("toToolExecutionContext", () => {
    it("does not carry a server on the request (tools read services off this.server)", () => {
        const ctx = makeCtx({ mcpReq: {} as never });
        const result = toToolExecutionContext(ctx);
        expect(result.request).not.toHaveProperty("server");
    });

    it("exposes the raw mcpReq the request was built around", () => {
        const mcpReq = { id: 7, method: "tools/call" } as never;
        const ctx = makeCtx({ mcpReq });
        const result = toToolExecutionContext(ctx);
        expect(result.request.raw).toBe(mcpReq);
        expect(result.request.id).toBe(7);
    });

    it("copies signal, _meta, inputResponses and notify from mcpReq", () => {
        const signal = new AbortController().signal;
        const notify = (): Promise<void> => Promise.resolve();
        const ctx = makeCtx({
            mcpReq: {
                signal,
                _meta: { progressToken: 1 },
                inputResponses: { confirm: { value: true } },
                notify,
            } as never,
        });
        const result = toToolExecutionContext(ctx);
        expect(result.request.signal).toBe(signal);
        expect(result.request._meta).toEqual({ progressToken: 1 });
        expect(result.request.inputResponses).toEqual({ confirm: { value: true } });
        expect(result.request.sendNotification).toBeDefined();
    });

    it("flattens HTTP request headers onto request.headers", () => {
        const headers = new Headers({ "x-request-id": "req-1" });
        const ctx = makeCtx({
            http: { req: { headers } } as never,
            mcpReq: {} as never,
        });
        const result = toToolExecutionContext(ctx);
        expect(result.request.headers?.["x-request-id"]).toBe("req-1");
    });

    it("has no headers when not served over HTTP", () => {
        const ctx = makeCtx({ mcpReq: {} as never });
        const result = toToolExecutionContext(ctx);
        expect(result.request.headers).toBeUndefined();
    });

    it("falls back to a fresh signal and no id for partial contexts (direct invocation)", () => {
        const result = toToolExecutionContext({} as ServerContext);
        expect(result.request.id).toBeUndefined();
        expect(result.request.signal).toBeInstanceOf(AbortSignal);
        expect(result.request.raw).toBeUndefined();
    });

    it("normalizes client info passed directly", () => {
        const ctx = makeCtx({ mcpReq: {} as never });
        const result = toToolExecutionContext(ctx, { name: "my-client", version: "1.0.0" });
        expect(result.request.clientInfo).toEqual({ name: "my-client", version: "1.0.0", title: "unknown" });
    });
});
