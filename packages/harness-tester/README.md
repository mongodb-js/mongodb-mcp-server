# @mongodb-js/harness-tester

Agent-only tooling for driving real LLM coding-agent CLIs interactively
through their TUIs, with **no MCP or MongoDB dependencies**.

Harnesses today: **[codex](https://github.com/openai/codex)** (OpenAI CLI
agent) and **[claude](https://github.com/anthropics/claude-code)** (Claude
Code CLI), both driven inside
[`@microsoft/tui-test`](https://github.com/microsoft/tui-test/blob/main/bindings/js/README.md)'s
headless terminal emulator.

What lives here:

- `harness/codex/`, `harness/claude/` — per-agent config generation, TUI
  drive loops, and transcript parsers (`AgentHarnessConfig` + `AgentHarness`
  implementations; see `harness/types.ts` for the contract).
- `harness/shared.ts` — helpers both harnesses share (canonical path
  handling, transcript diffing, backend resolution, tool-name normalization).
- `useAgent({ harness })` — a pure agent hook: temp workdir, availability
  skip gate, and base `AgentHarnessOptions` for a harness session (model
  overrides, timeout). Requires the harness instance explicitly.
- `AGENT_HARNESSES` — the registry of harness classes.

The MCP/MongoDB side of an e2e suite (in-process MongoDB MCP server, mongod
spin-up, connection wiring) lives in `packages/e2e-tests` (`useMcpAgent`),
which composes with the `useAgent` hook here. See that package's README for
how the two fit together.
