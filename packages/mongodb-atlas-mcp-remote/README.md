# mongodb-atlas-mcp-remote

> [!NOTE]
> This package is work in progress.

A lightweight stdio proxy that connects your local MCP client to the **MongoDB Atlas Remote MCP server**. It authenticates with Atlas using OAuth2 client credentials (a service account Client ID and Client Secret), then forwards MCP traffic between your client's stdio transport and the remote server over Streamable HTTP.

Use this package when you want the MongoDB Atlas MCP tools without running the full [`mongodb-mcp-server`](https://www.npmjs.com/package/mongodb-mcp-server) locally — the tools are executed by the hosted remote server, and this wrapper only handles authentication and message forwarding.

## Table of Contents

- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
- [Usage](#usage)
- [Proxy and Certificate Support](#proxy-and-certificate-support)
- [Contributing](#contributing)

## How it works

1. On startup the proxy reads your service account credentials from the environment and exchanges them for a short-lived OAuth2 access token from Atlas.
2. It opens a Streamable HTTP connection to the remote MCP server, attaching the access token as a bearer token.
3. Messages from your MCP client (over stdio) are forwarded to the remote server and responses are streamed back.
4. The access token is cached and automatically refreshed before it expires, and re-acquired if the remote responds with an authorization error.

Credentials and the access token are redacted from all logs.

## Prerequisites

- Node.js
  - At least v22.13.0. Check with `node -v`. (Node 20.x is supported but deprecated.)
- Atlas API Service Account credentials (a **Client ID** and **Client Secret**).
  - Follow the steps in the main repo README under [Atlas API Access](../../README.md#atlas-api-access) to create a service account and assign the minimum required permissions. See [Atlas API Permissions](../../README.md#atlas-api-permissions) for the roles needed per operation.

## Installation

The package is intended to be run via `npx`, so no explicit install is required — your MCP client will fetch it on demand (see [Usage](#usage)). To run it directly:

```shell
export MDB_MCP_API_CLIENT_ID="your-atlas-service-account-client-id"
export MDB_MCP_API_CLIENT_SECRET="your-atlas-service-account-client-secret"

npx -y mongodb-atlas-mcp-remote@latest
```

## Configuration

Configuration is provided entirely through environment variables.

> **🔒 Security Recommendation:** Provide credentials via environment variables rather than inline command-line arguments. Command-line arguments can be visible in process lists and logged in various system locations.

### Environment Variables

| Variable                    | Required | Default                     | Description                                                                                                          |
| --------------------------- | -------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `MDB_MCP_API_CLIENT_ID`     | Yes      | —                           | Atlas service account Client ID used for OAuth2 client-credentials authentication.                                   |
| `MDB_MCP_API_CLIENT_SECRET` | Yes      | —                           | Atlas service account Client Secret used for OAuth2 client-credentials authentication.                               |
| `MDB_MCP_API_BASE_URL`      | No       | `https://cloud.mongodb.com` | Base URL for the Atlas token endpoint and the remote MCP server. Override this only for non-production environments. |
| `MDB_MCP_TOKEN_TIMEOUT_MS`  | No       | `10000`                     | Timeout, in milliseconds, for the OAuth2 token request. Must be a positive integer.                                  |

If a required variable is missing or a value is invalid, the proxy logs a configuration error and exits.

## Usage

Add the server to your MCP client configuration. The exact file and syntax vary by client — see the [main README](../../README.md#quick-start) for client-specific links.

```json
{
  "mcpServers": {
    "MongoDB": {
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

## Proxy and Certificate Support

- **Proxies:** Outbound HTTP(S) requests honor the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables.
- **Certificate authorities:** The operating system's certificate store is trusted in addition to the bundled CAs (the same way `mongosh` does), so corporate root certificates installed at the OS level are picked up automatically.

## Contributing

This package lives in the [`mongodb-mcp-server`](https://github.com/mongodb-js/mongodb-mcp-server) monorepo under `packages/mongodb-atlas-mcp-remote`. See the repository [Contributing Guide](../../CONTRIBUTING.md) for development setup, testing, and release information.
