# mongodb-atlas-mcp-remote

`mongodb-atlas-mcp-remote` lets your MCP client connect to the **MongoDB Atlas Remote MCP server** using your Atlas service account credentials.

Use this for MCP clients that don't yet natively support service-account (OAuth client-credentials) authentication.

## Prerequisites

- Node.js v20.19.0 or newer.
- An Atlas service account **Client ID** and **Client Secret**. See [Atlas API Access](../../README.md#atlas-api-access) in the main README for how to create a service account and assign the minimum required permissions.

## Configuration

The wrapper is configured with two environment variables:

| Variable                    | Description                               |
| --------------------------- | ----------------------------------------- |
| `MDB_MCP_API_CLIENT_ID`     | Your Atlas service account Client ID.     |
| `MDB_MCP_API_CLIENT_SECRET` | Your Atlas service account Client Secret. |

> **🔒 Tip:** Provide credentials via environment variables rather than inline command-line arguments, since command-line arguments can be visible in process lists and logs.

## Usage

Add the server to your MCP client's configuration. The file location and format vary by client — examples for common clients are below. In each case, replace the placeholder credentials with your own.

### Claude Code

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": ["-y", "mongodb-atlas-mcp-remote@latest"],
      "env": {
        "MDB_MCP_API_CLIENT_ID": "your-atlas-service-account-client-id",
        "MDB_MCP_API_CLIENT_SECRET": "your-atlas-service-account-client-secret"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": ["-y", "mongodb-atlas-mcp-remote@latest"],
      "env": {
        "MDB_MCP_API_CLIENT_ID": "your-atlas-service-account-client-id",
        "MDB_MCP_API_CLIENT_SECRET": "your-atlas-service-account-client-secret"
      }
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.mongodb]
command = "npx"
args = ["-y", "mongodb-atlas-mcp-remote@latest"]

[mcp_servers.mongodb.env]
MDB_MCP_API_CLIENT_ID = "your-atlas-service-account-client-id"
MDB_MCP_API_CLIENT_SECRET = "your-atlas-service-account-client-secret"
```

## Contributing

This package is part of the [`mongodb-mcp-server`](https://github.com/mongodb-js/mongodb-mcp-server) monorepo. See the [Contributing Guide](../../CONTRIBUTING.md) for development setup.
