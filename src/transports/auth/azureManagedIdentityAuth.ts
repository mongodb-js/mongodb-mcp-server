import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { LRUCache } from "lru-cache";
import { LogId, type LoggerBase } from "../../common/logger.js";
import type { UserConfig } from "../../common/config.js";

// Simple cache for remote JWK set instances keyed by discovery URL
const jwksCache = new LRUCache<string, ReturnType<typeof createRemoteJWKSet>>({
	max: 10,
	ttl: 60 * 60 * 1000, // 1h
});

export interface AzureManagedIdentityAuthOptions {
	tenantId: string;
	audience?: string; // explicit audience override
	clientId?: string; // fallback audience if explicit not provided
}

function v2Issuer(tenantId: string): string {
	return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}

function v1Issuer(tenantId: string): string {
	// Legacy v1 tokens often have iss = https://sts.windows.net/<tenantId>/
	return `https://sts.windows.net/${tenantId}/`;
}

function buildOpenIdConfigUrl(tenantId: string): string {
	// We always fetch from the v2 discovery endpoint (jwks are valid for both)
	return `${v2Issuer(tenantId)}/.well-known/openid-configuration`;
}

async function getRemoteJwks(tenantId: string) {
	const discoveryUrl = buildOpenIdConfigUrl(tenantId);
	let jwks = jwksCache.get(discoveryUrl);
	if (!jwks) {
		const res = await fetch(discoveryUrl);
		if (!res.ok) {
			throw new Error(`Failed to fetch OpenID configuration: ${res.status} ${res.statusText}`);
		}
		const json = (await res.json()) as { jwks_uri: string };
		if (!json.jwks_uri) {
			throw new Error("jwks_uri not found in OpenID configuration");
		}
		jwks = createRemoteJWKSet(new URL(json.jwks_uri));
		jwksCache.set(discoveryUrl, jwks);
	}
	return jwks;
}

export function azureManagedIdentityAuthMiddleware(
	logger: LoggerBase,
	userConfig: UserConfig
): (req: Request, res: Response, next: NextFunction) => void {
	if (userConfig.httpAuthMode !== "azure-managed-identity") {
		return (_req, _res, next) => next();
	}

	const opts: AzureManagedIdentityAuthOptions = {
		tenantId: userConfig.azureManagedIdentityTenantId!,
		audience: userConfig.azureManagedIdentityAudience,
		clientId: userConfig.azureManagedIdentityClientId,
	};

	const expectedAud = opts.audience || opts.clientId;
	const requiredRoles = userConfig.azureManagedIdentityRequiredRoles || [];
	const roleMatchMode = userConfig.azureManagedIdentityRoleMatchMode || "all";
	const allowedAppIds = (userConfig.azureManagedIdentityAllowedAppIds || []).map((a) => a.toLowerCase());
	if (!expectedAud) {
		logger.warning({
			id: 0 as any,
			context: "azureManagedIdentityAuth",
			message: "No audience or clientId configured; 'aud' claim will not be enforced.",
		});
	}

	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			const authHeader = req.headers["authorization"];
			if (!authHeader || Array.isArray(authHeader)) {
				res.status(401).json({ error: "missing authorization header" });
				return;
			}
			const match = authHeader.match(/^Bearer (.+)$/i);
			if (!match) {
				res.status(401).json({ error: "invalid authorization header" });
				return;
			}
			const token = match[1]!; // non-null assertion since regex with capture succeeded
			const jwks = await getRemoteJwks(opts.tenantId);
			let verification;
			const issuersToTry = [v2Issuer(opts.tenantId), v1Issuer(opts.tenantId)];
			let lastErr: unknown;
			for (const iss of issuersToTry) {
				try {
					verification = await jwtVerify(token, jwks, {
						issuer: iss,
						audience: expectedAud, // undefined means not enforced
					});
					break;
				} catch (e) {
					lastErr = e;
				}
			}
			if (!verification) {
				throw lastErr ?? new Error("issuer validation failed");
			}

			// Basic sanity checks (subject, expiry handled by jose)
			const payload = verification.payload as Record<string, any>;
			if (!payload.sub) {
				logAuthFailure(logger, "missing-sub", payload, {
					message: "token missing sub",
				});
				res.status(401).json({ error: "unauthorized" });
				return;
			}

			// Enforce tenant id (tid) match for safety
			const configuredTid = opts.tenantId.toLowerCase();
			const tokenTid = (payload.tid || payload.tenantId || "").toLowerCase();
			if (!tokenTid) {
				logAuthFailure(logger, "missing-tid", payload, { message: "token missing tid claim" });
				res.status(401).json({ error: "unauthorized" });
				return;
			}
			if (tokenTid !== configuredTid) {
				logAuthFailure(logger, "tenant-mismatch", payload, {
					message: `tenant mismatch expected=${configuredTid} got=${tokenTid}`,
				});
				res.status(401).json({ error: "unauthorized" });
				return;
			}

			// Allowed application IDs (appid or azp) enforcement
			if (allowedAppIds.length > 0) {
				const tokenAppId = (payload.appid || payload.azp || "").toLowerCase();
				if (!tokenAppId || !allowedAppIds.includes(tokenAppId)) {
					logAuthFailure(logger, "appid-not-allowed", payload, {
						message: `application id not allowed: ${tokenAppId || "<none>"}`,
					});
					res.status(401).json({ error: "unauthorized" });
					return;
				}
			}

			// App role enforcement: 'roles' claim (array) for application permissions
			if (requiredRoles.length > 0) {
				const rolesClaim = Array.isArray(payload.roles) ? payload.roles : [];
				const tokenRoles = new Set(rolesClaim);
				const missingRoles = requiredRoles.filter((r) => !tokenRoles.has(r));
				const roleConditionMet =
					roleMatchMode === "all" ? missingRoles.length === 0 : missingRoles.length < requiredRoles.length;
				if (!roleConditionMet) {
					logAuthFailure(logger, "role-match-failed", payload, {
						message:
							roleMatchMode === "all"
								? `missing required roles: ${missingRoles.join(",")}`
								: `none of the required roles present; required any of: ${requiredRoles.join(",")}`,
						missingRoles,
					});
					res.status(401).json({ error: "unauthorized" });
					return;
				}
			}

			// Attach claims for downstream handlers if needed
			(req as any).azureManagedIdentity = payload;
			next();
		} catch (err) {
			logger.info({
				id: LogId.azureManagedIdentityAuthError,
				context: "azureManagedIdentityAuth",
				message: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
			});
			res.status(401).json({ error: "unauthorized" });
		}
	};
}

interface FailureMeta {
	message: string;
	missingScopes?: string[];
	missingRoles?: string[];
}

function logAuthFailure(
	logger: LoggerBase,
	reason:
		| "missing-sub"
		| "missing-roles"
		| "missing-tid"
		| "tenant-mismatch"
		| "role-match-failed"
		| "appid-not-allowed",
	claims: Record<string, any>,
	meta: FailureMeta
): void {
	// Only log a limited snapshot of claims for security (avoid tokens, only non-sensitive claims)
	const allowedKeys = ["aud", "iss", "sub", "scp", "roles", "appid", "tid", "oid", "exp", "nbf", "iat"];
	const snapshot: Record<string, any> = {};
	for (const key of allowedKeys) {
		if (key in claims) snapshot[key] = claims[key];
	}
	logger.info({
		id: LogId.azureManagedIdentityAuthError,
		context: "azureManagedIdentityAuth",
		message: `Authorization failure (${reason}): ${meta.message} snapshot=${JSON.stringify(snapshot)} missingScopes=${meta.missingScopes?.join("|") ?? ""} missingRoles=${meta.missingRoles?.join("|") ?? ""}`,
	});
}

// (scope-related reasons removed)
