import { describe, it, expect, vi } from "vitest";
import type express from "express";
import {
    createHostOriginValidationMiddleware,
    formatHostForHeader,
    isWildcardHost,
    normalizeOrigin,
} from "./hostOriginValidation.js";

function invokeMiddleware(
    middleware: express.RequestHandler,
    headers: Record<string, string | string[] | undefined>
): { nextCalled: boolean; statusCode?: number; body?: unknown } {
    let nextCalled = false;
    let statusCode: number | undefined;
    let body: unknown;

    const req = { headers } as unknown as express.Request;
    const res = {
        status(code: number) {
            statusCode = code;
            return res;
        },
        json(payload: unknown) {
            body = payload;
            return res;
        },
    } as unknown as express.Response;
    const next: express.NextFunction = () => {
        nextCalled = true;
    };

    middleware(req, res, next);
    return { nextCalled, statusCode, body };
}

describe("hostOriginValidation helpers", () => {
    it("detects wildcard bind hosts", () => {
        expect(isWildcardHost("")).toBe(true);
        expect(isWildcardHost("0.0.0.0")).toBe(true);
        expect(isWildcardHost("::")).toBe(true);
        expect(isWildcardHost("[::]")).toBe(true);
        expect(isWildcardHost("127.0.0.1")).toBe(false);
        expect(isWildcardHost("localhost")).toBe(false);
        expect(isWildcardHost("::1")).toBe(false);
    });

    it("formats IPv6 hosts with brackets", () => {
        expect(formatHostForHeader("::1")).toBe("[::1]");
        expect(formatHostForHeader("[::1]")).toBe("[::1]");
        expect(formatHostForHeader("127.0.0.1")).toBe("127.0.0.1");
        expect(formatHostForHeader("LOCALHOST")).toBe("localhost");
    });

    it("normalizes valid HTTP(S) origins and rejects unsafe values", () => {
        expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
        expect(normalizeOrigin("HTTPS://EXAMPLE.COM:443")).toBe("https://example.com");
        expect(normalizeOrigin("http://127.0.0.1:80")).toBe("http://127.0.0.1");
        expect(normalizeOrigin("http://[::1]:3000")).toBe("http://[::1]:3000");

        expect(normalizeOrigin("null")).toBeNull();
        expect(normalizeOrigin("")).toBeNull();
        expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
        expect(normalizeOrigin("file:///etc/passwd")).toBeNull();
        expect(normalizeOrigin("http://localhost:3000/path")).toBeNull();
        expect(normalizeOrigin("http://localhost:3000/")).toBeNull();
        expect(normalizeOrigin("http://user:pass@localhost:3000")).toBeNull();
        expect(normalizeOrigin("not-a-url")).toBeNull();
    });
});

describe("createHostOriginValidationMiddleware", () => {
    it("allows loopback Host headers with no Origin (non-browser MCP clients)", () => {
        const mw = createHostOriginValidationMiddleware({
            getResolvedPort: () => 3000,
            bindHost: "127.0.0.1",
        });

        for (const host of ["127.0.0.1:3000", "localhost:3000", "LOCALHOST:3000", "[::1]:3000"]) {
            const res = invokeMiddleware(mw, { host });
            expect(res.nextCalled).toBe(true);
        }
    });

    it("allows matching loopback Origin headers", () => {
        const mw = createHostOriginValidationMiddleware({
            getResolvedPort: () => 3000,
            bindHost: "127.0.0.1",
        });

        const res = invokeMiddleware(mw, {
            host: "127.0.0.1:3000",
            origin: "http://localhost:3000",
        });
        expect(res.nextCalled).toBe(true);
    });

    it("rejects forged or missing Host headers with 403", () => {
        const mw = createHostOriginValidationMiddleware({
            getResolvedPort: () => 3000,
            bindHost: "127.0.0.1",
        });

        for (const host of [
            undefined,
            "",
            "evil.example:3000",
            "127.0.0.1.evil.com:3000",
            "localhost:9999",
            "127.0.0.1",
        ]) {
            const res = invokeMiddleware(mw, { host });
            expect(res.nextCalled).toBe(false);
            expect(res.statusCode).toBe(403);
            expect(res.body).toEqual({ error: "Invalid Host header" });
        }
    });

    it("rejects forged, null, or malformed Origin headers with 403", () => {
        const mw = createHostOriginValidationMiddleware({
            getResolvedPort: () => 3000,
            bindHost: "127.0.0.1",
        });

        for (const origin of [
            "http://evil.example:3000",
            "https://evil.example",
            "http://localhost:3000.evil.com",
            "http://localhost:3001",
            "null",
            "http://localhost:3000/extra",
            ["http://localhost:3000", "http://evil.example"],
        ]) {
            const res = invokeMiddleware(mw, {
                host: "127.0.0.1:3000",
                origin,
            });
            expect(res.nextCalled).toBe(false);
            expect(res.statusCode).toBe(403);
            expect(res.body).toEqual({ error: "Invalid Origin header" });
        }
    });

    it("resolves ephemeral port lazily at request time", () => {
        let port = 0;
        const getResolvedPort = vi.fn(() => port);
        const mw = createHostOriginValidationMiddleware({
            getResolvedPort,
            bindHost: "127.0.0.1",
        });

        // Simulate server binding to ephemeral port 45678 after middleware setup
        port = 45678;

        expect(invokeMiddleware(mw, { host: "127.0.0.1:45678" }).nextCalled).toBe(true);
        expect(invokeMiddleware(mw, { host: "127.0.0.1:0" }).statusCode).toBe(403);
    });

    it("allows configured allowedHosts and allowedOrigins (reverse proxy deployments)", () => {
        const mw = createHostOriginValidationMiddleware({
            getResolvedPort: () => 3000,
            bindHost: "127.0.0.1",
            allowedHosts: ["mcp.example.com", "mcp.example.com:8443"],
            allowedOrigins: ["https://app.example.com/"],
        });

        expect(
            invokeMiddleware(mw, {
                host: "mcp.example.com",
                origin: "https://app.example.com",
            }).nextCalled
        ).toBe(true);

        expect(
            invokeMiddleware(mw, {
                host: "mcp.example.com:8443",
            }).nextCalled
        ).toBe(true);

        expect(
            invokeMiddleware(mw, {
                host: "sub.mcp.example.com",
            }).statusCode
        ).toBe(403);

        expect(
            invokeMiddleware(mw, {
                host: "mcp.example.com",
                origin: "https://other.example.com",
            }).statusCode
        ).toBe(403);
    });

    it("skips Host check on wildcard bind when no allowedHosts are set, while still enforcing Origin", () => {
        const mw = createHostOriginValidationMiddleware({
            getResolvedPort: () => 3000,
            bindHost: "0.0.0.0",
        });

        expect(invokeMiddleware(mw, { host: "custom-proxy.internal:3000" }).nextCalled).toBe(true);
        expect(
            invokeMiddleware(mw, {
                host: "custom-proxy.internal:3000",
                origin: "https://evil.example",
            }).statusCode
        ).toBe(403);
    });

    it("enforces Host on wildcard bind when allowedHosts is explicitly configured", () => {
        const mw = createHostOriginValidationMiddleware({
            getResolvedPort: () => 3000,
            bindHost: "0.0.0.0",
            allowedHosts: ["mcp.example.com"],
        });

        expect(invokeMiddleware(mw, { host: "mcp.example.com" }).nextCalled).toBe(true);
        expect(invokeMiddleware(mw, { host: "evil.example" }).statusCode).toBe(403);
    });
});
