# Configuration

> **🔒 Security Best Practice:** We strongly recommend using environment variables for sensitive configuration such as API credentials (`MDB_MCP_API_CLIENT_ID`, `MDB_MCP_API_CLIENT_SECRET`) and connection strings (`MDB_MCP_CONNECTION_STRING`) instead of command-line arguments. Environment variables are not visible in process lists and provide better security for your sensitive data.

The MongoDB MCP Server can be configured using multiple methods, with the following precedence (highest to lowest):

1. Command-line arguments
2. Environment variables
3. Configuration File

## 📚 Table of Contents

- [Configuration Options](#configuration-options)
  - [Atlas API Access](#atlas-api-access)
  - [Atlas API Permissions](#atlas-api-permissions)
  - [Configuration Methods](#configuration-methods)
    - [Configuration File](#configuration-file)
    - [Environment Variables](#environment-variables)
    - [Command-Line Arguments](#command-line-arguments)
    - [Proxy Support](#proxy-support)

## Configuration Options

| CLI Option                             | Environment Variable                                | Default                                                                                                | Description                                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiClientId`                          | `MDB_MCP_API_CLIENT_ID`                             | `<not set>`                                                                                            | Atlas API client ID for authentication. Required for running Atlas tools.                                                                                                                       |
| `apiClientSecret`                      | `MDB_MCP_API_CLIENT_SECRET`                         | `<not set>`                                                                                            | Atlas API client secret for authentication. Required for running Atlas tools.                                                                                                                   |
| `atlasTemporaryDatabaseUserLifetimeMs` | `MDB_MCP_ATLAS_TEMPORARY_DATABASE_USER_LIFETIME_MS` | `14400000`                                                                                             | Time in milliseconds that temporary database users created when connecting to MongoDB Atlas clusters will remain active before being automatically deleted.                                     |
| `confirmationRequiredTools`            | `MDB_MCP_CONFIRMATION_REQUIRED_TOOLS`               | `"atlas-create-access-list,atlas-create-db-user,drop-database,drop-collection,delete-many,drop-index"` | Comma separated values of tool names that require user confirmation before execution. Requires the client to support elicitation.                                                               |
| `connectionString`                     | `MDB_MCP_CONNECTION_STRING`                         | `<not set>`                                                                                            | MongoDB connection string for direct database connections. Optional, if not set, you'll need to call the connect tool before interacting with MongoDB data.                                     |
| `disableEmbeddingsValidation`          | `MDB_MCP_DISABLE_EMBEDDINGS_VALIDATION`             | `false`                                                                                                | When set to true, disables validation of embeddings dimensions.                                                                                                                                 |
| `disabledTools`                        | `MDB_MCP_DISABLED_TOOLS`                            | `""`                                                                                                   | Comma separated values of tool names, operation types, and/or categories of tools that will be disabled.                                                                                        |
| `exportCleanupIntervalMs`              | `MDB_MCP_EXPORT_CLEANUP_INTERVAL_MS`                | `120000`                                                                                               | Time in milliseconds between export cleanup cycles that remove expired export files.                                                                                                            |
| `exportTimeoutMs`                      | `MDB_MCP_EXPORT_TIMEOUT_MS`                         | `300000`                                                                                               | Time in milliseconds after which an export is considered expired and eligible for cleanup.                                                                                                      |
| `exportsPath`                          | `MDB_MCP_EXPORTS_PATH`                              | see below\*                                                                                            | Folder to store exported data files.                                                                                                                                                            |
| `httpHost`                             | `MDB_MCP_HTTP_HOST`                                 | `"127.0.0.1"`                                                                                          | Host address to bind the HTTP server to (only used when transport is 'http').                                                                                                                   |
| `httpPort`                             | `MDB_MCP_HTTP_PORT`                                 | `3000`                                                                                                 | Port number for the HTTP server (only used when transport is 'http').                                                                                                                           |
| `idleTimeoutMs`                        | `MDB_MCP_IDLE_TIMEOUT_MS`                           | `600000`                                                                                               | Idle timeout for a client to disconnect (only applies to http transport).                                                                                                                       |
| `indexCheck`                           | `MDB_MCP_INDEX_CHECK`                               | `false`                                                                                                | When set to true, enforces that query operations must use an index, rejecting queries that perform a collection scan.                                                                           |
| `logPath`                              | `MDB_MCP_LOG_PATH`                                  | see below\*                                                                                            | Folder to store logs.                                                                                                                                                                           |
| `loggers`                              | `MDB_MCP_LOGGERS`                                   | `"disk,mcp"` see below\*                                                                               | Comma separated values of logger types.                                                                                                                                                         |
| `maxBytesPerQuery`                     | `MDB_MCP_MAX_BYTES_PER_QUERY`                       | `16777216`                                                                                             | The maximum size in bytes for results from a find or aggregate tool call. This serves as an upper bound for the responseBytesLimit parameter in those tools.                                    |
| `maxDocumentsPerQuery`                 | `MDB_MCP_MAX_DOCUMENTS_PER_QUERY`                   | `100`                                                                                                  | The maximum number of documents that can be returned by a find or aggregate tool call. For the find tool, the effective limit will be the smaller of this value and the tool's limit parameter. |
| `notificationTimeoutMs`                | `MDB_MCP_NOTIFICATION_TIMEOUT_MS`                   | `540000`                                                                                               | Notification timeout for a client to be aware of disconnect (only applies to http transport).                                                                                                   |
| `previewFeatures`                      | `MDB_MCP_PREVIEW_FEATURES`                          | `""`                                                                                                   | Comma separated values of preview features that are enabled.                                                                                                                                    |
| `readOnly`                             | `MDB_MCP_READ_ONLY`                                 | `false`                                                                                                | When set to true, only allows read, connect, and metadata operation types, disabling create/update/delete operations.                                                                           |
| `telemetry`                            | `MDB_MCP_TELEMETRY`                                 | `"enabled"`                                                                                            | When set to disabled, disables telemetry collection.                                                                                                                                            |
| `toolMetadataOverrides`                | `MDB_MCP_TOOL_METADATA_OVERRIDES`                   | `"{}"`                                                                                                 | A map of name of the MongoDB MCP server tool to the metadata that needs to be used for that tool. Example: `{ "toolMetadataOverrides": { "find": { "name": "query" } } }`                       |
| `transport`                            | `MDB_MCP_TRANSPORT`                                 | `"stdio"`                                                                                              | Either 'stdio' or 'http'.                                                                                                                                                                       |
| `voyageApiKey`                         | `MDB_MCP_VOYAGE_API_KEY`                            | `""`                                                                                                   | API key for Voyage AI embeddings service (required for vector search operations with text-to-embedding conversion).                                                                             |

### Logger Options

The `loggers` configuration option controls where logs are sent. You can specify one or more logger types as a comma-separated list. The available options are:

- `mcp`: Sends logs to the MCP client (if supported by the client/transport).
- `disk`: Writes logs to disk files. Log files are stored in the log path (see `logPath` above).
- `stderr`: Outputs logs to standard error (stderr), useful for debugging or when running in containers.

**Default:** `disk,mcp` (logs are written to disk and sent to the MCP client).

You can combine multiple loggers, e.g. `--loggers disk stderr` or `export MDB_MCP_LOGGERS="mcp,stderr"`.

#### Example: Set logger via environment variable

```shell
export MDB_MCP_LOGGERS="disk,stderr"
```

> **💡 Platform Note:** For Windows users, see [Environment Variables](#environment-variables) for platform-specific instructions.

#### Example: Set logger via command-line argument

```shell
npx -y mongodb-mcp-server@latest --loggers mcp stderr
```

#### Log File Location

When using the `disk` logger, log files are stored in:

- **Windows:** `%LOCALAPPDATA%\mongodb\mongodb-mcp\.app-logs`
- **macOS/Linux:** `~/.mongodb/mongodb-mcp/.app-logs`

You can override the log directory with the `logPath` option.

> **🔒 Security Note:** When configuring a custom `logPath`, ensure the directory is owned and writable only by the user running the MongoDB MCP server process. On Linux/macOS, use `chmod 700` and verify ownership with `chown`. On Windows, restrict write permissions to the service account only.

### Disabled Tools

You can disable specific tools or categories of tools by using the `disabledTools` option. This option accepts an array of strings,
where each string can be a tool name, operation type, or category.

The way the array is constructed depends on the type of configuration method you use:

- For **environment variable** configuration, use a comma-separated string: `export MDB_MCP_DISABLED_TOOLS="create,update,delete,atlas,collectionSchema"`.
- For **command-line argument** configuration, use a space-separated string: `--disabledTools create update delete atlas collectionSchema`.

Categories of tools:

- `atlas` - MongoDB Atlas tools, such as list clusters, create cluster, etc.
- `mongodb` - MongoDB database tools, such as find, aggregate, etc.

Operation types:

- `create` - Tools that create resources, such as create cluster, insert document, etc.
- `update` - Tools that update resources, such as update document, rename collection, etc.
- `delete` - Tools that delete resources, such as delete document, drop collection, etc.
- `read` - Tools that read resources, such as find, aggregate, list clusters, etc.
- `metadata` - Tools that read metadata, such as list databases/collections/indexes, infer collection schema, etc.
- `connect` - Tools that allow you to connect or switch the connection to a MongoDB instance. If this is disabled, you will need to provide a connection string through the config when starting the server.

### Require Confirmation

If your client supports [elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation), you can set the MongoDB MCP server to request user confirmation before executing certain tools.

When a tool is marked as requiring confirmation, the server will send an elicitation request to the client. The client with elicitation support will then prompt the user for confirmation and send the response back to the server. If the client does not support elicitation, the tool will execute without confirmation.

You can set the `confirmationRequiredTools` configuration option to specify the names of tools which require confirmation. By default, the following tools have this setting enabled: `drop-database`, `drop-collection`, `delete-many`, `atlas-create-db-user`, `atlas-create-access-list`.

### Read-Only Mode

The `readOnly` configuration option allows you to restrict the MCP server to only use tools with "read", "connect", and "metadata" operation types. When enabled, all tools that have "create", "update" or "delete" operation types will not be registered with the server.

This is useful for scenarios where you want to provide access to MongoDB data for analysis without allowing any modifications to the data or infrastructure.

You can enable read-only mode using:

- **Environment variable**: `export MDB_MCP_READ_ONLY=true`
- **Command-line argument**: `--readOnly`

> **💡 Platform Note:** For Windows users, see [Environment Variables](#environment-variables) for platform-specific instructions.

When read-only mode is active, you'll see a message in the server logs indicating which tools were prevented from registering due to this restriction.

### Index Check Mode

The `indexCheck` configuration option allows you to enforce that query operations must use an index. When enabled, queries that perform a collection scan will be rejected to ensure better performance.

This is useful for scenarios where you want to ensure that database queries are optimized.

You can enable index check mode using:

- **Environment variable**: `export MDB_MCP_INDEX_CHECK=true`
- **Command-line argument**: `--indexCheck`

> **💡 Platform Note:** For Windows users, see [Environment Variables](#environment-variables) for platform-specific instructions.

When index check mode is active, you'll see an error message if a query is rejected due to not using an index.

### Exports

The data exported by the `export` tool is temporarily stored in the configured `exportsPath` on the machine running the MCP server until cleaned up by the export cleanup process. If the `exportsPath` configuration is not provided, the following defaults are used:

- **Windows:** `%LOCALAPPDATA%\mongodb\mongodb-mcp\exports`
- **macOS/Linux:** `~/.mongodb/mongodb-mcp/exports`

> **🔒 Security Note:** When configuring a custom `exportsPath`, ensure the directory is owned and writable only by the user running the MongoDB MCP server process. Exported data may contain sensitive information from your database. On Linux/macOS, use `chmod 700` and verify ownership with `chown`. On Windows, restrict write permissions to the service account only.

The `exportTimeoutMs` configuration controls the time after which the exported data is considered expired and eligible for cleanup. By default, exports expire after 5 minutes (300000ms).

The `exportCleanupIntervalMs` configuration controls how frequently the cleanup process runs to remove expired export files. By default, cleanup runs every 2 minutes (120000ms).

### Telemetry

The `telemetry` configuration option allows you to disable telemetry collection. When enabled, the MCP server will collect usage data and send it to MongoDB.

You can disable telemetry using:

- **Environment variable**: `export MDB_MCP_TELEMETRY=disabled`
- **Command-line argument**: `--telemetry disabled`
- **DO_NOT_TRACK environment variable**: `export DO_NOT_TRACK=1`

> **💡 Platform Note:** For Windows users, see [Environment Variables](#environment-variables) for platform-specific instructions.

### Opting into Preview Features

The MongoDB MCP Server may offer functionality that is still in development and may change in future releases. These features are considered "preview features" and are not enabled by default. Generally, these features are well tested, but may not offer the complete functionality we intend to provide in the final release or we'd like to gather feedback before making them generally available. To enable one or more preview features, use the `previewFeatures` configuration option.

- For **environment variable** configuration, use a comma-separated string: `export MDB_MCP_PREVIEW_FEATURES="vectorSearch,feature1,feature2"`.
- For **command-line argument** configuration, use a space-separated string: `--previewFeatures vectorSearch feature1 feature2`.

List of available preview features:

- `vectorSearch` - Enables tools or functionality related to Vector Search in MongoDB Atlas:
  - Index management, such as creating, listing, and dropping search and vector search indexes.
  - Querying collections using vector search capabilities. This requires a configured embedding model that will be used to generate vector representations of the query data. Currently, only [Voyage AI](https://www.voyageai.com) embedding models are supported. Set the `voyageApiKey` configuration option with your Voyage AI API key to use this feature.

## Atlas API Access

To use the Atlas API tools, you'll need to create a service account in MongoDB Atlas:

> **ℹ️ Note:** For a detailed breakdown of the minimum required permissions for each Atlas operation, see the [Atlas API Permissions](#atlas-api-permissions) section below.

1. **Create a Service Account:**
   - Log in to MongoDB Atlas at [cloud.mongodb.com](https://cloud.mongodb.com)
   - Navigate to Access Manager > Organization Access
   - Click Add New > Applications > Service Accounts
   - Enter name, description and expiration for your service account (e.g., "MCP, MCP Server Access, 7 days")
   - **Assign only the minimum permissions needed for your use case.**
     - See [Atlas API Permissions](#atlas-api-permissions) for details.
   - Click "Create"

To learn more about Service Accounts, check the [MongoDB Atlas documentation](https://www.mongodb.com/docs/atlas/api/service-accounts-overview/).

2. **Save Client Credentials:**
   - After creation, you'll be shown the Client ID and Client Secret
   - **Important:** Copy and save the Client Secret immediately as it won't be displayed again

3. **Add Access List Entry:**
   - Add your IP address to the API access list

4. **Configure the MCP Server:**
   - Use one of the configuration methods below to set your `apiClientId` and `apiClientSecret`

## Atlas API Permissions

> **Security Warning:** Granting the Organization Owner role is rarely necessary and can be a security risk. Assign only the minimum permissions needed for your use case.

### Quick Reference: Required roles per operation

| What you want to do                  | Safest Role to Assign (where)           |
| ------------------------------------ | --------------------------------------- |
| List orgs/projects                   | Org Member or Org Read Only (Org)       |
| Create new projects                  | Org Project Creator (Org)               |
| View clusters/databases in a project | Project Read Only (Project)             |
| Create/manage clusters in a project  | Project Cluster Manager (Project)       |
| Manage project access lists          | Project IP Access List Admin (Project)  |
| Manage database users                | Project Database Access Admin (Project) |

- **Prefer project-level roles** for most operations. Assign only to the specific projects you need to manage or view.
- **Avoid Organization Owner** unless you require full administrative control over all projects and settings in the organization.

For a full list of roles and their privileges, see the [Atlas User Roles documentation](https://www.mongodb.com/docs/atlas/reference/user-roles/#service-user-roles).

## Configuration Methods

### Configuration File

Store configuration in a JSON file and load it using the `MDB_MCP_CONFIG` environment variable (recommended) or `--config` command-line argument.

> **🔒 Security Best Practice:** Prefer using the `MDB_MCP_CONFIG` environment variable over the `--config` CLI argument. Command-line arguments are visible in process listings.

> **🔒 File Security:** Ensure your configuration file has proper ownership and permissions, limited to the user running the MongoDB MCP server:
>
> **Linux/macOS:**
>
> ```bash
> chmod 600 /path/to/config.json
> chown your-username /path/to/config.json
> ```
>
> **Windows:** Right-click the file → Properties → Security → Restrict access to your user account only.

Create a JSON file with your configuration (all keys use camelCase):

```json
{
  "connectionString": "mongodb://localhost:27017",
  "readOnly": true,
  "loggers": ["stderr", "mcp"],
  "apiClientId": "your-atlas-service-accounts-client-id",
  "apiClientSecret": "your-atlas-service-accounts-client-secret",
  "maxDocumentsPerQuery": 100
}
```

**Linux/macOS (bash/zsh):**

```bash
export MDB_MCP_CONFIG="/path/to/config.json"
npx -y mongodb-mcp-server@latest
```

**Windows Command Prompt (cmd):**

```cmd
set "MDB_MCP_CONFIG=C:\path\to\config.json"
npx -y mongodb-mcp-server@latest
```

**Windows PowerShell:**

```powershell
$env:MDB_MCP_CONFIG="C:\path\to\config.json"
npx -y mongodb-mcp-server@latest
```

Alternatively, use `--config` argument (less secure):

```bash
npx -y mongodb-mcp-server@latest --config /path/to/config.json
```

### Environment Variables

Set environment variables with the prefix `MDB_MCP_` followed by the option name in uppercase with underscores:

**Linux/macOS (bash/zsh):**

```bash
# Set Atlas API credentials (via Service Accounts)
export MDB_MCP_API_CLIENT_ID="your-atlas-service-accounts-client-id"
export MDB_MCP_API_CLIENT_SECRET="your-atlas-service-accounts-client-secret"

# Set a custom MongoDB connection string
export MDB_MCP_CONNECTION_STRING="mongodb+srv://username:password@cluster.mongodb.net/myDatabase"

# Set log path
export MDB_MCP_LOG_PATH="/path/to/logs"
```

**Windows Command Prompt (cmd):**

```cmd
set "MDB_MCP_API_CLIENT_ID=your-atlas-service-accounts-client-id"
set "MDB_MCP_API_CLIENT_SECRET=your-atlas-service-accounts-client-secret"

set "MDB_MCP_CONNECTION_STRING=mongodb+srv://username:password@cluster.mongodb.net/myDatabase"

set "MDB_MCP_LOG_PATH=C:\path\to\logs"
```

**Windows PowerShell:**

```powershell
# Set Atlas API credentials (via Service Accounts)
$env:MDB_MCP_API_CLIENT_ID="your-atlas-service-accounts-client-id"
$env:MDB_MCP_API_CLIENT_SECRET="your-atlas-service-accounts-client-secret"

# Set a custom MongoDB connection string
$env:MDB_MCP_CONNECTION_STRING="mongodb+srv://username:password@cluster.mongodb.net/myDatabase"

# Set log path
$env:MDB_MCP_LOG_PATH="C:\path\to\logs"
```

#### MCP configuration file examples

##### Connection String with environment variables

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb+srv://username:password@cluster.mongodb.net/myDatabase"
      }
    }
  }
}
```

##### Atlas API credentials with environment variables

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server"],
      "env": {
        "MDB_MCP_API_CLIENT_ID": "your-atlas-service-accounts-client-id",
        "MDB_MCP_API_CLIENT_SECRET": "your-atlas-service-accounts-client-secret"
      }
    }
  }
}
```

### Command-Line Arguments

Pass configuration options as command-line arguments when starting the server:

> **🔒 Security Note:** For sensitive configuration like API credentials and connection strings, use environment variables instead of command-line arguments.

```shell
# Set sensitive data as environment variable
export MDB_MCP_API_CLIENT_ID="your-atlas-service-accounts-client-id"
export MDB_MCP_API_CLIENT_SECRET="your-atlas-service-accounts-client-secret"
export MDB_MCP_CONNECTION_STRING="mongodb+srv://username:password@cluster.mongodb.net/myDatabase"

# Start the server with command line arguments
npx -y mongodb-mcp-server@latest --logPath=/path/to/logs --readOnly --indexCheck
```

> **💡 Platform Note:** The examples above use Unix/Linux/macOS syntax. For Windows users, see [Environment Variables](#environment-variables) for platform-specific instructions.

#### MCP client configuration file examples

##### Connection String with command-line arguments

> **🔒 Security Note:** We do not recommend passing connection string as command line argument. Connection string might contain credentials which can be visible in process lists and logged in various system locations, potentially exposing your credentials. Instead configure [connection string through environment variables](#connection-string-with-environment-variables)

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": [
        "-y",
        "mongodb-mcp-server",
        "--connectionString",
        "mongodb+srv://username:password@cluster.mongodb.net/myDatabase",
        "--readOnly"
      ]
    }
  }
}
```

##### Atlas API credentials with command-line arguments

> **🔒 Security Note:** We do not recommend passing Atlas API credentials as command line argument. The provided credentials can be visible in process lists and logged in various system locations, potentially exposing your credentials. Instead configure [Atlas API credentials through environment variables](#atlas-api-credentials-with-environment-variables)

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": [
        "-y",
        "mongodb-mcp-server",
        "--apiClientId",
        "your-atlas-service-accounts-client-id",
        "--apiClientSecret",
        "your-atlas-service-accounts-client-secret",
        "--readOnly"
      ]
    }
  }
}
```

## Proxy Support

The MCP Server will detect typical PROXY environment variables and use them for
connecting to the Atlas API, your MongoDB Cluster, or any other external calls
to third-party services like OID Providers. The behaviour is the same as what
`mongosh` does, so the same settings will work in the MCP Server.
