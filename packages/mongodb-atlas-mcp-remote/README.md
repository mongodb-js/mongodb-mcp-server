# mongodb-atlas-mcp-remote

> [!NOTE]
> This package is work in progress.

## Usage

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-atlas-mcp-remote@latest"],
      "env": {
        "MDB_MCP_API_CLIENT_ID": "atlas-mcp-sa-client-id",
        "MDB_MCP_API_CLIENT_SECRET": "atlas-mcp-sa-client-secret"
      }
    }
  }
}
```
