import { describe, it, expect } from "vitest";
import { toToolExecutionContext } from "./toolBase.js";
import type { ServerContext } from "@modelcontextprotocol/server";
import type { IToolConfig, ToolServer } from "@mongodb-js/mcp-types";

const config: IToolConfig = {
    transport: "stdio",
    httpResponseType: "json",
    readOnly: false,
    disabledTools: [],
    confirmationRequiredTools: [],
    previewFeatures: [],
};

const server: ToolServer = { config, logger: loggerStub(), keychain: { allSecrets: [] } } as ToolServer;

function loggerStub(): {
    debug: () => void;
    info: () => void;
    warning: () => void;
    error: () => void;
    log: () => void;
} {
    return {
        debug: (): void => {},
        info: (): void => {},
        warning: (): void => {},
        error: (): void => {},
        log: (): void => {},
    };
}

function makeCtx(overrides: Partial<ServerContext> = {}): ServerContext {
    return {
        mcpReq: {
            // Filled below per-test; cast through Partial to allow partial fakes.
        },
        ...overrides,
    } as unknown as ServerContext;
}

describe("toToolExecutionContext", () => {
    it("carries the request-scoped server on the request object (config = server.config)", () => {
        const ctx = makeCtx({ mcpReq: {} as never });
        const result = toToolExecutionContext(ctx, server);
        expect(result.request.server).toBe(server);
        expect(result.request.server.config).toBe(config);
    });

    it("exposes the raw mcpReq the request was built around", () => {
        const mcpReq = { id: 7, method: "tools/call" } as never;
        const ctx = makeCtx({ mcpReq });
        const result = toToolExecutionContext(ctx, server);
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
        const result = toToolExecutionContext(ctx, server);
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
        const result = toToolExecutionContext(ctx, server);
        expect(result.request.headers?.["x-request-id"]).toBe("req-1");
    });

    it("has no headers when not served over HTTP", () => {
        const ctx = makeCtx({ mcpReq: {} as never });
        const result = toToolExecutionContext(ctx, server);
        expect(result.request.headers).toBeUndefined();
    });

    it("falls back to a fresh signal and no id for partial contexts (direct invocation)", () => {
        const result = toToolExecutionContext({} as ServerContext, server);
        expect(result.request.id).toBeUndefined();
        expect(result.request.signal).toBeInstanceOf(AbortSignal);
        expect(result.request.raw).toBeUndefined();
    });

    it("normalizes client info from the provider", () => {
        const ctx = makeCtx({ mcpReq: {} as never });
        const result = toToolExecutionContext(ctx, server, () => ({ name: "my-client", version: "1.0.0" }));
        expect(result.request.clientInfo).toEqual({ name: "my-client", version: "1.0.0", title: "unknown" });
    });
});
