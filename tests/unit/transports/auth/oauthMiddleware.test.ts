import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import type { JwksCache } from "../../../../src/transports/auth/jwksCache.js";
import { createOAuthMiddleware, getAuthContext } from "../../../../src/transports/auth/oauthMiddleware.js";

// Mock oauth4webapi so the middleware can be unit-tested without real
// JWTs, real JWKS, or real network access. Each test below drives the
// mock to the outcome it wants to verify (signature OK, signature bad,
// etc.).
vi.mock("oauth4webapi", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        validateJwtAccessToken: vi.fn(),
    };
});

import * as oauth from "oauth4webapi";

const validateJwt = oauth.validateJwtAccessToken as unknown as ReturnType<typeof vi.fn>;

const ISSUER = "https://issuer.example.com";
const AUDIENCE = "mcp-test-audience";

function buildReqRes(authHeader?: string): {
    req: Request;
    res: Response;
    next: ReturnType<typeof vi.fn>;
    setHeaderSpy: ReturnType<typeof vi.fn>;
    statusSpy: ReturnType<typeof vi.fn>;
    jsonSpy: ReturnType<typeof vi.fn>;
} {
    const setHeaderSpy = vi.fn();
    const statusSpy = vi.fn();
    const jsonSpy = vi.fn();
    statusSpy.mockReturnValue({ json: jsonSpy });

    const req = {
        method: "POST",
        path: "/mcp",
        headers: authHeader ? { authorization: authHeader } : {},
    } as unknown as Request;

    const res = {
        setHeader: setHeaderSpy,
        status: statusSpy,
    } as unknown as Response;

    const next = vi.fn();
    return { req, res, next, setHeaderSpy, statusSpy, jsonSpy };
}

function buildMiddleware(jwksCacheBehavior: "ok" | "throw" = "ok"): ReturnType<typeof createOAuthMiddleware> {
    const fakeJwksCache: JwksCache = {
        getAuthorizationServer:
            jwksCacheBehavior === "ok"
                ? vi.fn().mockResolvedValue({ issuer: ISSUER })
                : vi.fn().mockRejectedValue(new Error("issuer unreachable")),
        clear: vi.fn(),
    } as unknown as JwksCache;

    const logger = {
        info: vi.fn(),
        debug: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    } as unknown as Parameters<typeof createOAuthMiddleware>[0]["logger"];

    return createOAuthMiddleware({
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksCache: fakeJwksCache,
        logger,
    });
}

describe("createOAuthMiddleware", () => {
    beforeEach(() => {
        validateJwt.mockReset();
    });

    it("returns 401 with WWW-Authenticate when Authorization header is missing", async () => {
        const { req, res, next, setHeaderSpy, statusSpy, jsonSpy } = buildReqRes();
        const mw = buildMiddleware("ok");

        await mw(req, res, next as unknown as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(statusSpy).toHaveBeenCalledWith(401);
        expect(setHeaderSpy).toHaveBeenCalledWith(
            "WWW-Authenticate",
            expect.stringMatching(/^Bearer .*realm="https:\/\/issuer\.example\.com".*error="invalid_request"/)
        );
        expect(jsonSpy).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ code: -32000 }) as unknown })
        );
    });

    it("returns 401 when Authorization header is not a Bearer scheme", async () => {
        const { req, res, next, statusSpy, setHeaderSpy } = buildReqRes("Basic Zm9vOmJhcg==");
        const mw = buildMiddleware("ok");

        await mw(req, res, next as unknown as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(statusSpy).toHaveBeenCalledWith(401);
        expect(setHeaderSpy).toHaveBeenCalledWith(
            "WWW-Authenticate",
            expect.stringContaining('error="invalid_request"')
        );
    });

    it("returns 503 when the JWKS cache cannot reach the issuer", async () => {
        const { req, res, next, statusSpy, jsonSpy } = buildReqRes("Bearer dummy.token.here");
        const mw = buildMiddleware("throw");

        await mw(req, res, next as unknown as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(statusSpy).toHaveBeenCalledWith(503);
        expect(jsonSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.objectContaining({
                    code: -32001,
                    message: expect.stringContaining("issuer unreachable") as unknown,
                }) as unknown,
            })
        );
    });

    it("returns 401 with invalid_token when oauth4webapi rejects the token", async () => {
        const { req, res, next, statusSpy, setHeaderSpy, jsonSpy } = buildReqRes("Bearer expired.token.here");
        const mw = buildMiddleware("ok");
        validateJwt.mockRejectedValueOnce(new Error("token has expired"));

        await mw(req, res, next as unknown as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(statusSpy).toHaveBeenCalledWith(401);
        expect(setHeaderSpy).toHaveBeenCalledWith(
            "WWW-Authenticate",
            expect.stringContaining('error="invalid_token"')
        );
        expect(jsonSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.objectContaining({ message: "token has expired" }) as unknown,
            })
        );
    });

    it("calls next() and sets req.auth on success (RFC 8693 `scope` claim)", async () => {
        const { req, res, next } = buildReqRes("Bearer valid.token.here");
        const mw = buildMiddleware("ok");
        validateJwt.mockResolvedValueOnce({
            sub: "alice@example.com",
            iss: ISSUER,
            aud: AUDIENCE,
            scope: "mcp:read mcp:metadata",
        });

        await mw(req, res, next as unknown as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
        expect(getAuthContext(req)).toEqual({
            sub: "alice@example.com",
            issuer: ISSUER,
            audience: [AUDIENCE],
            scopes: ["mcp:read", "mcp:metadata"],
        });
    });

    it("accepts Azure-style `scp` array scope claim", async () => {
        const { req, res, next } = buildReqRes("Bearer azure.token.here");
        const mw = buildMiddleware("ok");
        validateJwt.mockResolvedValueOnce({
            sub: "svc-account-1",
            iss: ISSUER,
            aud: [AUDIENCE, "other-aud"],
            scp: ["mcp:read", "mcp:create"],
        });

        await mw(req, res, next as unknown as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
        expect(getAuthContext(req)?.scopes).toEqual(["mcp:read", "mcp:create"]);
        expect(getAuthContext(req)?.audience).toEqual([AUDIENCE, "other-aud"]);
    });

    it("defaults scopes to [] when neither scope nor scp is present", async () => {
        const { req, res, next } = buildReqRes("Bearer scopeless.token");
        const mw = buildMiddleware("ok");
        validateJwt.mockResolvedValueOnce({
            sub: "u",
            iss: ISSUER,
            aud: AUDIENCE,
        });

        await mw(req, res, next as unknown as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
        expect(getAuthContext(req)?.scopes).toEqual([]);
    });
});
