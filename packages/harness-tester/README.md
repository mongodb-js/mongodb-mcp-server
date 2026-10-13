# @mongodb-js/harness-tester

Agent-only tooling for driving real LLM coding-agent CLIs interactively through their TUIs, with **no MCP or MongoDB dependencies**.

Harnesses: [codex](https://github.com/openai/codex) and [claude](https://github.com/anthropics/claude-code), driven inside [`@microsoft/tui-test`](https://github.com/microsoft/tui-test/blob/main/bindings/js/README.md)'s headless terminal emulator. Both need the agent binary on `PATH` and `GROVE_API_KEY`.

- `harness/codex/`, `harness/claude/` — per-agent config, TUI drive loops, and tool-call parsers (`AgentHarness`; the contract is in `harness/types.ts`). Turn text is raw terminal content — tests keyword-match it.
- `useAgent({ harness })` — vitest hook: temp workdir, availability skip gate, and base `AgentHarnessOptions`.
- `AGENT_HARNESSES` — registry of harness classes.

## Usage

Drive a harness directly:

```ts
import { ClaudeTuiHarness } from "@mongodb-js/harness-tester";

const harness = new ClaudeTuiHarness(); // or CodexTuiHarness
const session = await harness.start({
  workDir: "/tmp/agent-session",
  serverUrl: "http://127.0.0.1:3000/mcp",
  mcpServerName: "mongo",
});

try {
  const turn = await session.prompt("List the databases on the mongo server.");
  console.log(turn.text, turn.toolCalls);
} finally {
  await session.dispose();
}
```

In a vitest suite, `useAgent` creates a temp workdir, skips when the harness is unavailable, and builds base options:

```ts
import { describe, expect, it } from "vitest";
import { CodexTuiHarness, useAgent } from "@mongodb-js/harness-tester";

describe("mongo agent", () => {
  const { harness, buildOptions } = useAgent({
    harness: new CodexTuiHarness(),
  });

  it("lists databases", async () => {
    const session = await harness.start(
      buildOptions({ serverUrl: "http://127.0.0.1:3000/mcp" })
    );
    try {
      const turn = await session.prompt("List the databases.");
      expect(turn.toolCalls.map((call) => call.name)).toContain(
        "list-databases"
      );
    } finally {
      await session.dispose();
    }
  });
});
```

When a turn pauses for confirmation, answer it with `chooseOption`:

```ts
const turn = await session.prompt('Use "drop-database" to drop "test_db".');
if (turn.state === "elicitation") {
  await session.chooseOption("confirm"); // or "decline"
}
```

## Remote servers: headers and OAuth

`AgentHarnessOptions` can point a harness at a remote MCP server instead of spawning one:

- `serverUrl` — streamable HTTP endpoint (mutually exclusive with `stdioServer`).
- `headers` — extra HTTP headers for that server, e.g. `{ Authorization: "Bearer ..." }`.
- `oauth` — pre-seeded OAuth credentials (`accessToken`, and optional `refreshToken`, `expiresAt`, `clientId`, `clientSecret`, `scopes`, `issuer`). The harness writes them into the agent's native credential store before startup, so no interactive browser login is needed.

| Harness | OAuth store                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------- |
| codex   | `$CODEX_HOME/.credentials.json`, with `mcp_oauth_credentials_store = "file"` in the generated config |
| claude  | the `mcpOAuth` map in `$CLAUDE_CONFIG_DIR/.credentials.json`                                         |

`oauth` cannot be combined with `stdioServer`. On macOS, claude normally reads the `Claude Code-credentials` OS keychain, which the seeded file does not override (the file store is the fallback used on CI/Linux).

## Environment variables

| Variable                 | Purpose                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| `GROVE_API_KEY`          | Provider key for the grove gateway (required).                        |
| `AGENT_E2E_MODEL`        | Shared model override (overridden by the per-harness vars).           |
| `AGENT_E2E_CODEX_MODEL`  | Codex model override (default: host config model, else `gpt-6-luna`). |
| `AGENT_E2E_CLAUDE_MODEL` | Claude model override (default: `claude-haiku-5-5`).                  |
| `AGENT_E2E_CODEX_BIN`    | Codex binary path (default: `codex`).                                 |
| `AGENT_E2E_CLAUDE_BIN`   | Claude binary path (default: `claude`).                               |
| `AGENT_E2E_TUI_BACKEND`  | tui-test backend: `alacritty` (default), `ghostty`, `rio`.            |
| `AGENT_E2E_DEBUG`        | Dump config (redacted), TUI state, and agent replies.                 |

The MCP/MongoDB side of an e2e suite (in-process MongoDB MCP server, mongod spin-up, connection wiring) lives in `packages/e2e-tests` (`useMcpAgent`), which composes with `useAgent`. See that package's README.
