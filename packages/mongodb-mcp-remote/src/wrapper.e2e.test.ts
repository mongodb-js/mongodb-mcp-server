import { describe, it } from "vitest";

/**
 * These run in the default test flow but are skipped unless real ingress
 * service-account credentials are present, so runs without secrets are not impacted.
 *
 * Skip when:
 *   - SKIP_REMOTE_MCP_E2E=true, or
 *   - no REMOTE_MCP_E2E_CLIENT_ID is set
 * TODO: The tests below will be implemented in by MCP-539 once wrapper is code complete (MCP-536).
 */
const skipE2E = process.env.SKIP_REMOTE_MCP_E2E === "true" || !process.env.REMOTE_MCP_E2E_CLIENT_ID;

describe.skipIf(skipE2E)("mongodb-mcp-remote wrapper (e2e, cloud-dev)", () => {
    it.todo("acquires a token from the configured Atlas endpoint and lists tools");
    // Spawn the built wrapper against MDB_MCP_API_* (cloud-dev ingress creds), then:
    //   const res = await client.listTools();
    //   expect(res.tools.length).toBeGreaterThan(0);

    it.todo("invokes a read-only tool end-to-end against cloud-dev");

    it.todo("surfaces a clear auth error when the ingress credentials are invalid");
});
