import { describe, it, expect } from "vitest";
import { toToolExecutionContext } from "./toolBase.js";
import { CLIENT_INFO_META_KEY, type ServerContext } from "@modelcontextprotocol/server";

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

    it("reads client info from the per-request envelope (2026-07-28 modern path)", () => {
        const ctx = makeCtx({
            mcpReq: { envelope: { [CLIENT_INFO_META_KEY]: { name: "envelope-client", version: "2.0.0" } } } as never,
        });
        const result = toToolExecutionContext(ctx);
        expect(result.request.clientInfo).toEqual({
            name: "envelope-client",
            version: "2.0.0",
            title: "unknown",
        });
    });

    it("falls back to the negotiated client info when no envelope declaration exists (2025-era legacy path)", () => {
        const ctx = makeCtx({ mcpReq: {} as never });
        const result = toToolExecutionContext(ctx, { name: "legacy-client", version: "1.0.0" });
        expect(result.request.clientInfo).toEqual({
            name: "legacy-client",
            version: "1.0.0",
            title: "unknown",
        });
    });

    it("prefers the envelope client info even when a negotiated value is also supplied", () => {
        const ctx = makeCtx({
            mcpReq: { envelope: { [CLIENT_INFO_META_KEY]: { name: "envelope-client", version: "2.0.0" } } } as never,
        });
        const result = toToolExecutionContext(ctx, { name: "negotiated-client", version: "1.0.0" });
        expect(result.request.clientInfo).toEqual({
            name: "envelope-client",
            version: "2.0.0",
            title: "unknown",
        });
    });

    it("leaves clientInfo undefined when neither envelope nor negotiated value is present", () => {
        const ctx = makeCtx({ mcpReq: {} as never });
        const result = toToolExecutionContext(ctx);
        expect(result.request.clientInfo).toBeUndefined();
    });
});
