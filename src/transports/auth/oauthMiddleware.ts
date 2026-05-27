import type { NextFunction, Request, Response } from "express";
import * as oauth from "oauth4webapi";
import type { LoggerBase } from "../../common/logging/index.js";
import { LogId } from "../../common/logging/index.js";
import { JwksCache } from "./jwksCache.js";

/**
 * Authentication context attached to an Express request by the OAuth
 * middleware. Tools and downstream middleware can read it via
 * {@link getAuthContext} to find out who is making the call. The shape
 * is intentionally narrow: we surface only the subject, audience,
 * issuer, and granted scopes; the raw token is never exposed past the
 * middleware so it cannot accidentally land in logs or telemetry.
 */
export interface AuthContext {
    /** RFC 7519 `sub` claim — stable principal identifier from the IdP. */
    sub: string;
    /** Parsed RFC 8693 `scope` claim (space-delimited string → array). Accepts Azure-style `scp` array too. */
    scopes: string[];
    /** RFC 7519 `aud` claim, normalised to an array. */
    audience: string[];
    /** Issuer that minted the token. */
    issuer: string;
}

/**
 * Read the AuthContext attached by the middleware. Returns undefined
 * when OAuth is disabled (loopback bind without `oauthIssuer`).
 *
 * Express's Request type is not globally augmented (that would require
 * @types/express-serve-static-core, which this package does not ship
 * as a direct dependency), so reads go through this typed accessor.
 */
export function getAuthContext(req: Request): AuthContext | undefined {
    return (req as Request & { auth?: AuthContext }).auth;
}

export interface OAuthMiddlewareOptions {
    /** Issuer URL — must exactly match the `iss` claim in incoming tokens. */
    issuer: string;
    /** Expected `aud` claim. Tokens whose `aud` does not include this are rejected. */
    audience: string;
    /** Shared JWKS / discovery cache. */
    jwksCache: JwksCache;
    /** Logger for audit + diagnostic events. */
    logger: LoggerBase;
}

/**
 * 401 helper that emits a spec-compliant `WWW-Authenticate: Bearer ...`
 * header. The `error` and `error_description` parameters follow
 * RFC 6750 §3 so well-behaved clients can react programmatically (and
 * so security scanners can grade us correctly).
 */
function send401(
    res: Response,
    error: "invalid_request" | "invalid_token",
    description: string,
    issuer: string
): void {
    const params = [`realm="${issuer}"`, `error="${error}"`, `error_description="${description.replace(/"/g, "'")}"`];
    res.setHeader("WWW-Authenticate", `Bearer ${params.join(", ")}`);
    res.status(401).json({
        jsonrpc: "2.0",
        error: {
            code: -32000,
            message: description,
        },
    });
}

/**
 * Build an Express middleware that requires a valid OAuth/OIDC bearer
 * token on every request. Returns 401 with a proper `WWW-Authenticate`
 * header on missing or invalid tokens.
 *
 * Token validation:
 *   - signature against the issuer's JWKS (fetched via OIDC discovery,
 *     cached by {@link JwksCache})
 *   - `iss` claim equals the configured issuer
 *   - `aud` claim contains the configured audience
 *   - `exp` not in the past, `nbf` not in the future
 *
 * Per RFC 9068, the token's JOSE header must declare `typ: at+jwt`.
 * Most modern enterprise IdPs (Azure AD v2, Auth0, Okta) issue this
 * format; configure your IdP accordingly.
 *
 * No introspection (RFC 7662) is performed — we trust the issuer's
 * signature and the token's own claims. Add introspection in a v2 if
 * revocation-before-expiry is a requirement.
 */
export function createOAuthMiddleware({ issuer, audience, jwksCache, logger }: OAuthMiddlewareOptions) {
    const issuerForReporting = issuer;
    return async function oauthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
        const header = req.headers.authorization;
        if (!header || typeof header !== "string" || !header.toLowerCase().startsWith("bearer ")) {
            logger.debug({
                id: LogId.httpOAuthMissingToken,
                context: "oauthMiddleware",
                message: `Refused request to ${req.method} ${req.path}: missing or malformed Authorization header.`,
                noRedaction: true,
            });
            send401(res, "invalid_request", "Authorization: Bearer <token> header is required.", issuerForReporting);
            return;
        }

        let as: oauth.AuthorizationServer;
        try {
            as = await jwksCache.getAuthorizationServer(issuer);
        } catch (cause) {
            // Discovery failure was already logged at error level inside
            // the cache. Surface 503 because the *server* couldn't reach
            // the issuer — this is not a client error and clients should
            // retry.
            res.status(503).json({
                jsonrpc: "2.0",
                error: {
                    code: -32001,
                    message: `OAuth issuer ${issuerForReporting} is unreachable: ${(cause as Error).message}`,
                },
            });
            return;
        }

        // oauth4webapi.validateJwtAccessToken takes a Request object so it
        // can inspect the Authorization header itself. Construct a
        // minimal Request wrapping just the header to avoid forwarding
        // the full Express body.
        const proxyRequest = new Request("https://internal.invalid/", {
            headers: { authorization: header },
        });

        let claims: oauth.JWTAccessTokenClaims;
        try {
            claims = await oauth.validateJwtAccessToken(as, proxyRequest, audience);
        } catch (cause) {
            logger.warning({
                id: LogId.httpOAuthInvalidToken,
                context: "oauthMiddleware",
                message: `Rejected bearer token: ${(cause as Error).message}`,
                noRedaction: true,
            });
            send401(res, "invalid_token", (cause as Error).message, issuerForReporting);
            return;
        }

        // RFC 8693 `scope` claim is a space-delimited string. Some IdPs
        // (Azure AD) use the `scp` array form; accept both.
        const rawScopes = (claims as Record<string, unknown>).scope ?? (claims as Record<string, unknown>).scp ?? "";
        const scopes = Array.isArray(rawScopes)
            ? rawScopes.filter((s): s is string => typeof s === "string")
            : typeof rawScopes === "string"
              ? rawScopes.split(/\s+/).filter(Boolean)
              : [];

        const audClaim = claims.aud;
        const audArray = Array.isArray(audClaim) ? audClaim : [audClaim];

        (req as Request & { auth?: AuthContext }).auth = {
            sub: claims.sub,
            scopes,
            audience: audArray,
            issuer: claims.iss,
        };

        next();
    };
}
