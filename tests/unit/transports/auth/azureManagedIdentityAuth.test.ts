import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response } from "express";
import type { UserConfig } from "../../../../src/common/config.js";
import { LoggerBase, LogId } from "../../../../src/common/logger.js";

// --- Module mocks (must be declared before importing code under test) ---
const jwtVerifyMock = vi.fn();
const createRemoteJWKSetMock = vi.fn(() => ({}));
vi.mock("jose", () => ({
  jwtVerify: (token: any, jwks: any, options: any) => jwtVerifyMock(token, jwks, options),
  createRemoteJWKSet: () => createRemoteJWKSetMock(),
}));

// Import AFTER mocks so middleware picks them up
import { azureManagedIdentityAuthMiddleware } from "../../../../src/transports/auth/azureManagedIdentityAuth.js";

class TestLogger extends LoggerBase {
  protected readonly type = "mcp" as const;
  public entries: { level: string; payload: any }[] = [];
  protected logCore(level: any, payload: any): void {
    this.entries.push({ level, payload });
  }
  findMessage(sub: string) {
    return this.entries.find((e) => e.payload.message.includes(sub));
  }
  messagesById(id: number) {
    return this.entries.filter((e) => e.payload.id?.__value === id);
  }
}

function baseConfig(partial: Partial<UserConfig>): UserConfig {
  return {
    apiBaseUrl: "",
    logPath: "",
    exportsPath: "",
    exportTimeoutMs: 0,
    exportCleanupIntervalMs: 0,
    disabledTools: [],
    telemetry: "disabled" as any,
    readOnly: false,
    indexCheck: false,
    confirmationRequiredTools: [],
    transport: "http",
    httpPort: 0,
    httpHost: "",
    loggers: [],
    idleTimeoutMs: 0,
    notificationTimeoutMs: 0,
    httpHeaders: {},
    atlasTemporaryDatabaseUserLifetimeMs: 0,
    httpAuthMode: "azure-managed-identity",
    ...partial,
  } as UserConfig;
}

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function mockRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json } as unknown as Response & { status: any; json: any };
}

// Helper to set up fetch discovery response
function mockDiscovery(ok: boolean, data?: any) {
  return vi.spyOn(global, "fetch" as any).mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "ERR",
    json: async () => data,
  } as any);
}

describe("azureManagedIdentityAuthMiddleware", () => {
  let logger: TestLogger;
  beforeEach(() => {
    logger = new TestLogger(undefined as any);
    jwtVerifyMock.mockReset();
    createRemoteJWKSetMock.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bypasses when mode not enabled", async () => {
    const mw = azureManagedIdentityAuthMiddleware(logger, baseConfig({ httpAuthMode: "none" }));
    const next = vi.fn();
    await mw(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 401 when authorization header missing", async () => {
    const mw = azureManagedIdentityAuthMiddleware(logger, baseConfig({ azureManagedIdentityTenantId: "tid1" }));
    const res = mockRes();
    const next = vi.fn();
    await mw(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.status.mock.results[0].value.json).toHaveBeenCalledWith({ error: "missing authorization header" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when authorization header malformed", async () => {
    const mw = azureManagedIdentityAuthMiddleware(logger, baseConfig({ azureManagedIdentityTenantId: "tid2" }));
    const res = mockRes();
    const next = vi.fn();
    await mw(mockReq({ authorization: "Bad token" }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.status.mock.results[0].value.json).toHaveBeenCalledWith({ error: "invalid authorization header" });
    expect(next).not.toHaveBeenCalled();
  });

  it("successfully authenticates and attaches claims", async () => {
    const token = "abc.def.ghi";
    const fetchSpy = mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "user", tid: "tid3", aud: "api://aud", appid: "app123" } });

    const mw = azureManagedIdentityAuthMiddleware(
      logger,
      baseConfig({ azureManagedIdentityTenantId: "tid3", azureManagedIdentityAudience: "api://aud" })
    );
    const next = vi.fn();
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    await mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(jwtVerifyMock).toHaveBeenCalled();
    expect((req as any).azureManagedIdentity.sub).toBe("user");
  });

  it("falls back to v1 issuer after v2 failure", async () => {
    mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock
      .mockRejectedValueOnce(new Error("issuer mismatch"))
      .mockResolvedValueOnce({ payload: { sub: "x", tid: "tid4" } });

    const mw = azureManagedIdentityAuthMiddleware(logger, baseConfig({ azureManagedIdentityTenantId: "tid4" }));
    const next = vi.fn();
    await mw(mockReq({ authorization: "Bearer tok" }), mockRes(), next);
    expect(jwtVerifyMock).toHaveBeenCalledTimes(2);
    const issuers = jwtVerifyMock.mock.calls.map((c) => c[2].issuer);
    expect(issuers[0]).toMatch(/login\.microsoftonline/);
    expect(issuers[1]).toMatch(/sts\.windows\.net/);
    expect(next).toHaveBeenCalled();
  });

  it("fails when sub missing", async () => {
    mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { tid: "tid5" } });
    const mw = azureManagedIdentityAuthMiddleware(logger, baseConfig({ azureManagedIdentityTenantId: "tid5" }));
    const res = mockRes();
    await mw(mockReq({ authorization: "Bearer t" }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(logger.findMessage("missing-sub")).toBeTruthy();
  });

  it("fails when tid missing", async () => {
    mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "u" } });
    const mw = azureManagedIdentityAuthMiddleware(logger, baseConfig({ azureManagedIdentityTenantId: "tid6" }));
    const res = mockRes();
    await mw(mockReq({ authorization: "Bearer t" }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(logger.findMessage("missing-tid")).toBeTruthy();
  });

  it("fails when tenant mismatch", async () => {
    mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "u", tid: "other" } });
    const mw = azureManagedIdentityAuthMiddleware(logger, baseConfig({ azureManagedIdentityTenantId: "tid7" }));
    const res = mockRes();
    await mw(mockReq({ authorization: "Bearer t" }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(logger.findMessage("tenant-mismatch")).toBeTruthy();
  });

  it("enforces allowedAppIds (denied)", async () => {
    mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "u", tid: "tid8", appid: "bad" } });
    const mw = azureManagedIdentityAuthMiddleware(
      logger,
      baseConfig({ azureManagedIdentityTenantId: "tid8", azureManagedIdentityAllowedAppIds: ["good"] })
    );
    const res = mockRes();
    await mw(mockReq({ authorization: "Bearer t" }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(logger.findMessage("appid-not-allowed")).toBeTruthy();
  });

  it("enforces allowedAppIds (allowed)", async () => {
    mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "u", tid: "tid9", appid: "good" } });
    const mw = azureManagedIdentityAuthMiddleware(
      logger,
      baseConfig({ azureManagedIdentityTenantId: "tid9", azureManagedIdentityAllowedAppIds: ["GOOD"] })
    );
    const next = vi.fn();
    await mw(mockReq({ authorization: "Bearer t" }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("role enforcement all mode fails", async () => {
    mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "u", tid: "tid10", roles: ["r1"] } });
    const mw = azureManagedIdentityAuthMiddleware(
      logger,
      baseConfig({ azureManagedIdentityTenantId: "tid10", azureManagedIdentityRequiredRoles: ["r1", "r2"] })
    );
    const res = mockRes();
    await mw(mockReq({ authorization: "Bearer t" }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(logger.findMessage("role-match-failed")).toBeTruthy();
  });

  it("role enforcement all mode succeeds", async () => {
    mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "u", tid: "tid11", roles: ["r1", "r2", "extra"] } });
    const mw = azureManagedIdentityAuthMiddleware(
      logger,
      baseConfig({ azureManagedIdentityTenantId: "tid11", azureManagedIdentityRequiredRoles: ["r1", "r2"] })
    );
    const next = vi.fn();
    await mw(mockReq({ authorization: "Bearer t" }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("role enforcement any mode fails", async () => {
    mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "u", tid: "tid12", roles: ["other"] } });
    const mw = azureManagedIdentityAuthMiddleware(
      logger,
      baseConfig({
        azureManagedIdentityTenantId: "tid12",
        azureManagedIdentityRequiredRoles: ["r1", "r2"],
        azureManagedIdentityRoleMatchMode: "any",
      })
    );
    const res = mockRes();
    await mw(mockReq({ authorization: "Bearer t" }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("role enforcement any mode succeeds", async () => {
    mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "u", tid: "tid13", roles: ["r2"] } });
    const mw = azureManagedIdentityAuthMiddleware(
      logger,
      baseConfig({
        azureManagedIdentityTenantId: "tid13",
        azureManagedIdentityRequiredRoles: ["r1", "r2"],
        azureManagedIdentityRoleMatchMode: "any",
      })
    );
    const next = vi.fn();
    await mw(mockReq({ authorization: "Bearer t" }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("logs warning when no audience/clientId configured", async () => {
    mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "u", tid: "tid14" } });
    const mw = azureManagedIdentityAuthMiddleware(
      logger,
      baseConfig({ azureManagedIdentityTenantId: "tid14", azureManagedIdentityAudience: undefined, azureManagedIdentityClientId: undefined })
    );
    const next = vi.fn();
    await mw(mockReq({ authorization: "Bearer t" }), mockRes(), next);
    expect(next).toHaveBeenCalled();
    const warn = logger.entries.find((e) => e.level === "warning" && e.payload.message.includes("No audience"));
    expect(warn).toBeTruthy();
  });

  it("caches JWK set for same tenant", async () => {
    const fetchSpy = mockDiscovery(true, { jwks_uri: "https://example/jwks" });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "u", tid: "tid15" } });
    const config = baseConfig({ azureManagedIdentityTenantId: "tid15" });
    const mw1 = azureManagedIdentityAuthMiddleware(logger, config);
    const mw2 = azureManagedIdentityAuthMiddleware(logger, config);
    await mw1(mockReq({ authorization: "Bearer a" }), mockRes(), vi.fn());
    await mw2(mockReq({ authorization: "Bearer b" }), mockRes(), vi.fn());
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("handles fetch discovery failure", async () => {
    const fetchSpy = mockDiscovery(false, {});
    const mw = azureManagedIdentityAuthMiddleware(logger, baseConfig({ azureManagedIdentityTenantId: "tid16" }));
    const res = mockRes();
    await mw(mockReq({ authorization: "Bearer t" }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    // logged as info with Token verification failed
    const info = logger.findMessage("Token verification failed");
    expect(info).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalled();
  });
});
