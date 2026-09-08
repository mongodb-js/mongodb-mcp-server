# Agent harness e2e tests

End-to-end tests that drive the **built** MongoDB MCP server through a real LLM coding-agent CLI — [codex](https://github.com/openai/codex) and [claude](https://github.com/anthropics/claude-code) — interactively through their TUI inside [`@microsoft/tui-test`](https://github.com/microsoft/tui-test/blob/main/bindings/js/README.md)'s headless terminal emulator, instead of an SDK MCP client.

## Tests

- `setup.test.ts` — the server boots under each harness as an MCP client; a `list-databases` read round-trips against a local mongod and the agent's reply reflects real on-disk state.
- `toolDiscovery.test.ts` — the full MCP tool set, from two angles: a direct MCP client against the in-process server, and each harness enumerating the `mongo` server's tools.

## Running

```sh
pnpm run build          # build mongodb-mcp-server
codex --version         # or AGENT_E2E_CODEX_BIN
claude --version        # or AGENT_E2E_CLAUDE_BIN
export GROVE_API_KEY=... # both harnesses authenticate via the grove gateway
pnpm run test:e2e-tests
```

Tests **skip** when a harness binary or credentials are missing (not part of the default `pnpm test`).

## Environment variables

| Variable                                       | Purpose                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GROVE_API_KEY`                                | Provider key for the grove gateway (both harnesses). Required locally and in CI.    |
| `AGENT_E2E_MODEL`                              | Shared model override (overridden by the per-harness vars below).                   |
| `AGENT_E2E_CODEX_MODEL`                        | Codex model override (default: the model in use on this machine).                   |
| `AGENT_E2E_CLAUDE_MODEL`                       | Claude model override (default: `claude-haiku-4-5`).                                |
| `AGENT_E2E_CODEX_BIN` / `AGENT_E2E_CLAUDE_BIN` | Harness binary paths.                                                               |
| `AGENT_E2E_TUI_BACKEND`                        | tui-test backend: `alacritty` (default), `ghostty`, `rio`.                          |
| `AGENT_E2E_DEBUG`                              | Debug output: config dumps (redacted), TUI state/transcript streams, agent replies. |

## How it works

- `packages/e2e-tests` (this package) — MCP-side glue + suites: local mongod (`MongoDBClusterProcess`, no docker), the in-process server (`inProcessServer.ts`), and `useMcpAgent({ harness })` composing those with the agent-only hook.
- `packages/harness-tester` — agent-only tooling with no MCP/MongoDB dependencies: codex/claude TUI harnesses, transcript parsers, and the `useAgent` hook (workdir + availability skip gate).
- The server runs **in-process** (streamable HTTP on a random port, `AllTools` from the built package); the harness registers it by URL (e.g. `mcp_servers.mongo.url`), so nothing spawns a stdio subprocess.
- Codex config (`CodexHarnessConfig`) is hermetic: MCP server by URL, pre-trusted workdir, `grove` provider keyed by `GROVE_API_KEY`, shell/web-search disabled, and `plugin-management` disabled to avoid a `codex_apps` connector stall.
- Claude (`ClaudeHarnessConfig`) seeds a hermetic `CLAUDE_CONFIG_DIR` that suppresses onboarding/trust dialogs and whitelists MCP tools (no bash/file/web), and registers the server via `--mcp-config --strict-mcp-config`; auth is `ANTHROPIC_AUTH_TOKEN` against grove's Anthropic endpoint.
- `prompt()` types into the composer, waits for the idle marker (`Ask Codex to do anything` / `❯`), then captures the raw terminal content (scrollback delta + live viewport) and parses tool calls. Tests keyword-match the raw content — exact reply extraction is unreliable across TUIs.

## CI

`.github/workflows/e2e-tests.yml` runs on `main` pushes, `workflow_dispatch`, and PRs labeled `e2e-tests` (the release PR from `prepare-release.yml` carries the label automatically). Requires the `GROVE_API_KEY` secret; tui-test bundles headless emulators for all platforms, so no extra system dependencies.
