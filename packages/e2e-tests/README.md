# Agent harness e2e tests

A single end-to-end test that drives the **built** MongoDB MCP server through
a real LLM coding-agent harness (the thing a user would actually install the
server into), instead of connecting an SDK MCP client directly.

Harnesses today: **[codex](https://github.com/openai/codex)** (OpenAI CLI
agent) and **[claude](https://github.com/anthropics/claude-code)** (Claude
Code CLI), both driven **interactively through their real TUI** inside
[`@microsoft/tui-test`](https://github.com/microsoft/tui-test/blob/main/bindings/js/README.md)'s
headless terminal emulator.

## What is covered

| File                    | Scope                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup.test.ts`         | Server boots under each harness as an MCP client; tools are discoverable; a real read (`list-databases`) round-trips against a local mongod and the agent's reply reflects real on-disk state.     |
| `toolDiscovery.test.ts` | The full MCP tool set, from two angles: a direct MCP client against the in-process server (ground truth — every tool + schema), and each harness enumerating the tools the `mongo` server exposes. |

## Package split

- `packages/e2e-tests` (this package) — the MCP-specific glue + test suites:
  the local mongod, the in-process MongoDB MCP server (`inProcessServer.ts`),
  and `useMcpAgent({ harness })` which composes those with the agent-only
  hook.
- `packages/harness-tester` (`@mongodb-js/harness-tester`) — agent-only
  tooling with no MCP/MongoDB dependencies: the codex/claude TUI harnesses,
  transcript parsers, and the pure `useAgent({ harness })` hook (workdir + availability
  skip gate + base options).

The suite is deliberately minimal: one happy-path turn, no interactive prompt
answering. Everything each agent could interrupt with is disabled through
config so the TUI runs unattended (see "How it works").

## Running

```sh
# built server + codex + claude binaries + grove auth are required
pnpm run build                  # builds the mongodb-mcp-server package (AllTools runner)
codex --version                 # or: bin/codex on PATH / AGENT_E2E_CODEX_BIN
claude --version                # or: AGENT_E2E_CLAUDE_BIN

# auth — codex runs gpt-5.6-luna (reasoning effort low) through the
# OpenAI-compatible `grove` gateway; claude runs claude-haiku-4-5 through
# grove's Anthropic endpoint. Both key off GROVE_API_KEY (env_key in the
# generated codex provider config / ANTHROPIC_AUTH_TOKEN for claude), no
# secret in the repo.
export GROVE_API_KEY=...        # required locally and in CI (GitHub secret)

pnpm run test:agent-e2e         # runs the vitest `agent-e2e` project
```

If a harness binary or credentials are missing, that harness's tests **skip**
(the suite is not part of the default `pnpm test`).

## Environment variables

| Variable                  | Purpose                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GROVE_API_KEY`           | Provider API key for the grove gateway (both codex and claude sessions). No secret in the repo. Required locally and in CI.                       |
| `AGENT_E2E_CODEX_MODEL`   | Codex model override (default: the model codex uses on this machine, i.e. `gpt-5.6-luna`).                                                        |
| `AGENT_E2E_CLAUDE_MODEL`  | Claude model override (default: `claude-haiku-4-5`; grove serves the undated id).                                                                |
| `AGENT_E2E_MODEL`         | Shared model override for both harnesses (overridden by the per-harness vars above).                                                             |
| `CODEX_HOME`              | Override codex config dir; tests set a per-session temp dir so your real `~/.codex` is never touched.                                            |
| `AGENT_E2E_CODEX_BIN`     | Override the codex binary path.                                                                                                                  |
| `AGENT_E2E_CLAUDE_BIN`    | Override the claude binary path.                                                                                                                 |
| `AGENT_E2E_TUI_BACKEND`   | tui-test emulator backend: `alacritty` (default), `ghostty`, or `rio`.                                                                           |

## How it works

1. `useMcpAgent({ harness })` (called inside each per-harness `describe`
   block) composes
   two layers: the agent-only hook from `@mongodb-js/harness-tester`
   (temp workdir + availability skip gate, wired through `beforeAll`/
   `afterAll`) and the MongoDB-specific pieces this package owns — a local
   mongod (binary download via `MongoDBClusterProcess`, no docker) and the
   in-process MongoDB MCP server.
2. The server runs **in-process** (streamable HTTP transport on a random
   localhost port, `AllTools` registry from the built `mongodb-mcp-server`
   package, see `inProcessServer.ts`) — no stdio subprocess spawned by the
   agent; the connection string is baked into that server's config.
3. Codex (`CodexTuiHarness.start()`):
   - writes a hermetic `$CODEX_HOME/config.toml` registering the MCP server
     by its URL (`mcp_servers.mongo.url = "http://127.0.0.1:PORT/mcp"`);
   - pre-trusts the test workdir (`projects.<workdir>.trust_level`), so the
     directory-trust prompt never appears;
   - picks the model codex already uses on this machine (locally) or the
     `grove` provider keyed by `GROVE_API_KEY` (CI/local env);
   - disables the `plugin-management` plugin so codex does not eagerly start
     the `codex_apps` MCP connector (ChatGPT desktop integration) and stall.

   No approval-policy, sandbox, or tool allow-list/deny-list settings are
   added: gating MCP tools through those config knobs can hide them from the
   model's toolset, and the happy-path test never triggers approval prompts.

4. Claude (`ClaudeTuiHarness.start()`) seeds a hermetic `CLAUDE_CONFIG_DIR`
   with the state that suppresses first-run dialogs:
   - `settings.json` → `skipDangerousModePermissionPrompt: true` (suppresses
     the Bypass-Permissions warning);
   - `.claude.json` → `hasCompletedOnboarding: true` + `theme` (suppresses
     the theme/terminal-setup gates) and a `projects[realpath(workdir)]`
     entry with `hasTrustDialogAccepted: true` (suppresses workspace trust);
   - registers the MCP server via `--mcp-config <file> --strict-mcp-config`;
   - auth via `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_CUSTOM_HEADERS` pointing at
     grove's Anthropic endpoint — deliberately no `ANTHROPIC_API_KEY`, which
     would trigger a custom-key consent dialog.

5. `CodexTuiSession.prompt()` / `ClaudeTuiSession.prompt()` type the prompt
   into the composer, press Enter, wait until the composer returns to its idle
   state (`Ask Codex to do anything` / `❯` without `esc to interrupt`), then
   parse the terminal scrollback for tool calls + the reply. Note: the claude
   TUI collapses tool calls to the server name (`Called mongo`), so the tool
   call assertion normalizes to that; the reply reflects real mongod state.
6. The assertion verifies the tool call and that the agent's reply reflects
   **actual mongod state** (a seeded database appears in the listing) — ground
   truth, not just what the agent said.

## CI

`.github/workflows/agent-e2e-tests.yml` runs the suite on `main` pushes,
`workflow_dispatch`, and PRs labeled `agent-e2e-tests`. It installs both the
codex and claude CLIs. Set the `GROVE_API_KEY` secret (and optionally the
`AGENT_E2E_CODEX_MODEL` / `AGENT_E2E_CLAUDE_MODEL` repo variables). tui-test's
npm package bundles the headless emulators for all platforms, so no additional
system dependencies are needed. Stories without the label / forks are skipped.
