# @mongodb-js/harness-tester

Agent-only tooling for driving real LLM coding-agent CLIs interactively through their TUIs, with **no MCP or MongoDB dependencies**.

Harnesses today: [codex](https://github.com/openai/codex) and [claude](https://github.com/anthropics/claude-code), both driven inside [`@microsoft/tui-test`](https://github.com/microsoft/tui-test/blob/main/bindings/js/README.md)'s headless terminal emulator.

What lives here:

- `harness/codex/`, `harness/claude/` — per-agent config generation, TUI drive loops, and tool-call parsers (`AgentHarnessConfig` + `AgentHarness` implementations; the contract is in `harness/types.ts`). Turn text is raw terminal content, not an extracted reply — tests keyword-match it.
- `harness/shared.ts` — shared helpers (canonical path handling, transcript diffing, backend resolution, tool-name normalization).
- `useAgent({ harness })` — pure agent hook: temp workdir, availability skip gate, and base `AgentHarnessOptions` (model overrides, timeout).
- `AGENT_HARNESSES` — the registry of harness classes.

The MCP/MongoDB side of an e2e suite (in-process MongoDB MCP server, mongod spin-up, connection wiring) lives in `packages/e2e-tests` (`useMcpAgent`), which composes with the `useAgent` hook here. See that package's README.
