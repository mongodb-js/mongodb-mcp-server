# Harness-Specific Configuration

Configuration examples for various MCP clients. For working with MongoDB Atlas, it is recommended to use the Atlas-managed MCP Server. For clients that don't natively support HTTP/OAuth transport, use the [`mongodb-atlas-mcp-remote`](packages/mongodb-atlas-mcp-remote/README.md) proxy package with Service Account credentials instead.

For self-managed and local deployments, you can run the MCP Server locally using the `mongodb-mcp-server` package.

## Devin Desktop

([Devin Desktop documentation](https://docs.devin.ai/desktop/cascade/mcp))

Edit `~/.codeium/windsurf/mcp_config.json`.

**Atlas Remote MCP:**

```json
{
  "mcpServers": {
    "MongoDB": {
      "serverUrl": "https://mcp.mongodb.com/mcp",
      "headers": {}
    }
  }
}
```

> Devin Desktop handles OAuth automatically for HTTP servers.

**Local MCP:**

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server@latest", "--readOnly"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/myDatabase"
      }
    }
  }
}
```

## VS Code

([VS Code documentation](https://code.visualstudio.com/docs/copilot/chat/mcp-servers))

Create or edit `.vscode/mcp.json` in your workspace (or run **MCP: Open User Configuration** for a global config).

**Atlas Remote MCP:**

```json
{
  "servers": {
    "MongoDB": {
      "type": "http",
      "url": "https://mcp.mongodb.com/",
      "oauth": {
        "clientId": "https://vscode.dev/oauth/client-metadata.json"
      }
    }
  }
}
```

**Local MCP:**

```json
{
  "servers": {
    "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server@latest", "--readOnly"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/myDatabase"
      }
    }
  }
}
```

## Claude Desktop

([Claude Desktop documentation](https://modelcontextprotocol.io/quickstart/user))

Edit `claude_desktop_config.json`:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**Atlas Remote MCP:**

```json
{
  "mcpServers": {
    "MongoDB": {
      "type": "http",
      "url": "https://mcp.mongodb.com/",
      "oauth": {
        "clientId": "https://claude.ai/oauth/claude-code-client-metadata"
      }
    }
  }
}
```

**Local MCP:**

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server@latest", "--readOnly"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/myDatabase"
      }
    }
  }
}
```

## Cursor

([Cursor documentation](https://docs.cursor.com/context/model-context-protocol))

Edit `~/.cursor/mcp.json`.

**Atlas Remote MCP:**

```json
{
  "mcpServers": {
    "MongoDB": {
      "type": "http",
      "url": "https://mcp.mongodb.com/",
      "auth": {
        "CLIENT_ID": "anysphere-cursor"
      }
    }
  }
}
```

**Local MCP:**

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server@latest", "--readOnly"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/myDatabase"
      }
    }
  }
}
```

## Copilot CLI

([Copilot CLI documentation](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli))

**Atlas Remote MCP:**

```shell
copilot mcp add --transport http MongoDB https://mcp.mongodb.com/
```

Or from an interactive session, use the `/mcp add` slash command and fill in the details.

**Local MCP:**

```shell
copilot mcp add --transport stdio MongoDB -- npx -y mongodb-mcp-server@latest --readOnly
```

Alternatively, create or edit `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server@latest", "--readOnly"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/myDatabase"
      }
    }
  }
}
```

## OpenCode

([OpenCode documentation](https://opencode.ai/docs/mcp-servers))

Create or edit your OpenCode config file (`~/.config/opencode/opencode.json` or project-specific `./opencode.json`).

**Atlas Remote MCP:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "MongoDB": {
      "type": "remote",
      "url": "https://mcp.mongodb.com/",
      "enabled": true
    }
  }
}
```

> OpenCode handles OAuth automatically for remote servers.

**Local MCP:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "MongoDB": {
      "type": "local",
      "command": ["npx", "-y", "mongodb-mcp-server@latest", "--readOnly"],
      "enabled": true,
      "environment": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/myDatabase"
      }
    }
  }
}
```

## Codex

([Codex documentation](https://github.com/openai/codex))

Add to `~/.codex/config.toml`.

**Remote MCP (via `mongodb-atlas-mcp-remote` proxy):**

Codex doesn't natively support HTTP/OAuth transport. Use the [`mongodb-atlas-mcp-remote`](packages/mongodb-atlas-mcp-remote/README.md) proxy with Service Account credentials:

```toml
[mcp_servers.MongoDB]
command = "npx"
args = ["-y", "mongodb-atlas-mcp-remote@latest"]

[mcp_servers.MongoDB.env]
MDB_MCP_API_CLIENT_ID = "your-client-id"
MDB_MCP_API_CLIENT_SECRET = "your-client-secret"
```

**Local MCP:**

```toml
[mcp_servers.MongoDB]
command = "npx"
args = ["-y", "mongodb-mcp-server@latest", "--readOnly"]

[mcp_servers.MongoDB.env]
MDB_MCP_CONNECTION_STRING = "mongodb://localhost:27017/myDatabase"
```
