# mongodb-atlas-mcp-remote

`mongodb-atlas-mcp-remote` lets your MCP client connect to the **MongoDB Atlas Remote MCP server** using credentials from your Atlas MCP configuration.

Use this for MCP clients that don't yet natively support service-account (OAuth client-credentials) authentication.

## Prerequisites

- Node.js 20.19+, 22.13+, or 24+.
- A **Client ID** and **Client Secret** from a MongoDB Atlas **MCP configuration**. Creating an MCP configuration in Atlas provisions a dedicated Client ID and Client Secret that is used to authenticate to the Remote MCP server. Creating one requires the **Organization Owner** or **Project Owner** role.

  > **Note:** These credentials are generated specifically for the Remote MCP server and are **different** from the standard Atlas API service-account credentials used by the local [`mongodb-mcp-server`](../../README.md) package.

## Configuration

The wrapper is configured with two environment variables:

| Variable                    | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `MDB_MCP_API_CLIENT_ID`     | The Client ID from your Atlas MCP configuration.     |
| `MDB_MCP_API_CLIENT_SECRET` | The Client Secret from your Atlas MCP configuration. |

## Usage

Add the server to your MCP client's configuration. The file location and format vary by client — examples for common clients are below. In each case, replace the placeholder credentials with your own.

### Claude Code

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-atlas-mcp-remote@latest"],
      "env": {
        "MDB_MCP_API_CLIENT_ID": "your-client-id",
        "MDB_MCP_API_CLIENT_SECRET": "your-client-secret"
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
    "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-atlas-mcp-remote@latest"],
      "env": {
        "MDB_MCP_API_CLIENT_ID": "your-client-id",
        "MDB_MCP_API_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.MongoDB]
command = "npx"
args = ["-y", "mongodb-atlas-mcp-remote@latest"]

[mcp_servers.MongoDB.env]
MDB_MCP_API_CLIENT_ID = "your-client-id"
MDB_MCP_API_CLIENT_SECRET = "your-client-secret"
```

## HTTP Compatibility

The wrapper's HTTP connection uses the MCP SDK's default `redirectPolicy: "same-origin"`. Cross-origin redirects and redirects that would rewrite a POST's method (`301`, `302`, or `303`) are rejected. Same-origin `307` and `308` redirects can be followed. Use the final MCP endpoint URL rather than relying on a redirecting proxy or alias.

See the library guide's [HTTP compatibility requirements](../../MCP_SERVER_LIBRARY.md#http-compatibility) for protocol headers, legacy session support, and request size limits. The client-facing stdio transport is unchanged.

## Contributing

This package is part of the [`mongodb-mcp-server`](https://github.com/mongodb-js/mongodb-mcp-server) monorepo. See the [Contributing Guide](../../CONTRIBUTING.md) for development setup.
