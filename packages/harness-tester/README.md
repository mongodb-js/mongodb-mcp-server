# @mongodb-js/harness-tester

Agent-only tooling for driving real LLM coding-agent CLIs interactively through their TUIs, with **no MCP or MongoDB dependencies**.

Harnesses today: [codex](https://github.com/openai/codex) and [claude](https://github.com/anthropics/claude-code), both driven inside [`@microsoft/tui-test`](https://github.com/microsoft/tui-test/blob/main/bindings/js/README.md)'s headless terminal emulator.

What lives here:

- `harness/codex/`, `harness/claude/` — per-agent config generation, TUI drive loops, and tool-call parsers (`AgentHarnessConfig` + `AgentHarness` implementations; the contract is in `harness/types.ts`). Turn text is raw terminal content, not an extracted reply — tests keyword-match it.
- `harness/shared.ts` — shared helpers (canonical path handling, transcript diffing, backend resolution, tool-name normalization).
- `useAgent({ harness })` — pure agent hook: temp workdir, availability skip gate, and base `AgentHarnessOptions` (model overrides, timeout).
- `AGENT_HARNESSES` — the registry of harness classes.

## Remote servers: headers and OAuth

`AgentHarnessOptions` can point a harness at a remote MCP server instead of spawning one:

- `serverUrl` — streamable HTTP endpoint (mutually exclusive with `stdioServer`).
- `headers` — extra HTTP headers for that server, e.g. `{ Authorization: "Bearer ..." }`.
- `oauth` — pre-seeded OAuth credentials (`accessToken`, and optional `refreshToken`, `expiresAt`, `clientId`, `clientSecret`, `scopes`, `issuer`). The harness writes them into the agent's native credential store before startup, so no interactive browser login is needed.

Where `oauth` is written:

| Harness | Store                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------- |
| codex   | `$CODEX_HOME/.credentials.json`, with `mcp_oauth_credentials_store = "file"` in the generated config |
| claude  | the `mcpOAuth` map in `$CLAUDE_CONFIG_DIR/.credentials.json`                                         |

`oauth` cannot be combined with `stdioServer`. On macOS, claude normally reads the `Claude Code-credentials` OS keychain, which the seeded file does not override (the file store is the fallback used on CI/Linux).

The MCP/MongoDB side of an e2e suite (in-process MongoDB MCP server, mongod spin-up, connection wiring) lives in `packages/e2e-tests` (`useMcpAgent`), which composes with the `useAgent` hook here. See that package's README.
