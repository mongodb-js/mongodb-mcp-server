# Developer's Guide to Embedding and Extending the MongoDB MCP Server

This guide explains how to embed and extend the MongoDB MCP Server as a library to customize its core functionality and behavior for your specific use cases.

## 📚 Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Use Cases](#use-cases)
  - [Use Case 1: Override Server Configuration](#use-case-1-override-server-configuration)
  - [Use Case 2: Per-Session Configuration](#use-case-2-per-session-configuration)
  - [Use Case 3: Adding Custom Tools](#use-case-3-adding-custom-tools)
  - [Use Case 4: Selective Tool Registration](#use-case-4-selective-tool-registration)
- [API Reference](#api-reference)
- [Advanced Topics](#advanced-topics)
- [Examples](#examples)

## Overview

The MongoDB MCP Server can be embedded in your own Node.js applications and customized to meet specific requirements. The library exports provide full control over:

- Server configuration and initialization
- Per-session (MCP Client session) configuration hooks
- Tool registration
- Connection management and Connection error handling

## Installation

Install the MongoDB MCP Server package:

```bash
npm install mongodb-mcp-server
```

The package provides both CommonJS and ES Module exports.

## Core Concepts

### Exported Modules

The library exports are organized in two entry points:

**Main Library (`mongodb-mcp-server`):**

```typescript
import {
  Server,
  Session,
  UserConfig,
  UserConfigSchema,
  parseUserConfig,
  StreamableHttpRunner,
  StdioRunner,
  TransportRunnerBase,
  LoggerBase,
  Telemetry,
  Keychain,
  Elicitation,
  MongoDBError,
  ErrorCodes,
  connectionErrorHandler,
  createMCPConnectionManager,
  applyConfigOverrides,
  // ... and more
} from "mongodb-mcp-server";
```

**Tools (`mongodb-mcp-server/tools`):**

```typescript
import {
  ToolBase,
  AllTools,
  MongoDbTools,
  AtlasTools,
  AtlasLocalTools,
  type ToolClass,
} from "mongodb-mcp-server/tools";
```

For detailed documentation of these exports and their usage, see the [API Reference](#api-reference) section.

### Architecture

The MongoDB MCP Server library follows a modular architecture:

- **Transport Runners**: `StdioRunner` and `StreamableHttpRunner` manage the MCP transport layer
- **Server**: Core server that wraps the MCP Server and registers tools and resources
- **Session**: Per-client (MCP Client) connection and configuration state
- **Tools**: Individual capabilities exposed to the MCP client
- **Configuration**: User configuration with override mechanisms

## Use Cases

### Use Case 1: Override Server Configuration

Configure the MCP server with custom settings, such as HTTP headers for authentication before establishing session for an MCP Client.

#### Example: Setting HTTP Headers for Authentication

```typescript
import { StreamableHttpRunner, UserConfigSchema } from "mongodb-mcp-server";

// Create a custom configuration with HTTP headers
const config = UserConfigSchema.parse({
  transport: "http",
  httpPort: 3000,
  httpHost: "127.0.0.1",
  httpHeaders: {
    "x-api-key": "your-secret-api-key",
  },
  // Or your own connection string
  connectionString: "mongodb://localhost:27017",
  // Enable read-only mode for enhanced security
  readOnly: true,
});

// Initialize and start the server
const runner = new StreamableHttpRunner({ userConfig: config });
await runner.start();

console.log(`MongoDB MCP Server listening on ${runner.serverAddress}`);
```

Clients connecting to this server must include the specified headers in their requests, otherwise their Session initialization request is declined.

#### Example: Customizing Tool Availability

```typescript
import { StdioRunner, UserConfigSchema } from "mongodb-mcp-server";

const config = UserConfigSchema.parse({
  transport: "stdio",
  // Or your own connection string
  connectionString: "mongodb://localhost:27017",
  // Disable write operations
  readOnly: true,
  // Disable specific tool categories
  disabledTools: ["atlas", "atlas-local"],
  // Customize tools requiring confirmation
  confirmationRequiredTools: ["find", "aggregate"],
  // Set query limits
  maxDocumentsPerQuery: 50,
  maxBytesPerQuery: 10 * 1024 * 1024, // 10MB
});

const runner = new StdioRunner({ userConfig: config });
await runner.start();
```

### Use Case 2: Per-Session Configuration

Customize configuration for each MCP client session, enabling user-specific permissions and settings.

#### Example: User-Based Tool Permissions

```typescript
import {
  UserConfigSchema,
  StreamableHttpRunner,
  type TransportRunnerConfig,
} from "mongodb-mcp-server";
import type { OperationType } from "mongodb-mcp-server/tools";

// Example interface for user roles and permissions
interface UserPermissions {
  role: "admin" | "developer" | "analyst";
  allowedOperations: OperationType[];
  maxDocuments: number;
}

// Mock function to fetch user permissions (replace with your auth logic)
async function getUserPermissions(userId: string): Promise<UserPermissions> {
  const userDb = {
    "user-123": {
      role: "analyst",
      allowedOperations: ["read", "metadata"],
      maxDocuments: 100,
    },
    "user-456": {
      role: "developer",
      allowedOperations: ["read", "metadata", "create", "update"],
      maxDocuments: 500,
    },
    "user-789": {
      role: "admin",
      allowedOperations: ["read", "metadata", "create", "update", "delete"],
      maxDocuments: 1000,
    },
  } as Record<string, UserPermissions>;

  return (
    userDb[userId] || {
      role: "analyst",
      allowedOperations: ["read"],
      maxDocuments: 10,
    }
  );
}

// Base configuration for all sessions
const baseConfig = UserConfigSchema.parse({
  transport: "http",
  httpPort: 3000,
  httpHost: "127.0.0.1",
});

// Session configuration hook
const createSessionConfig: TransportRunnerConfig["createSessionConfig"] =
  async ({ userConfig, request }) => {
    // Extract user ID from request headers
    const userId = request?.headers?.["x-user-id"];

    if (typeof userId !== "string") {
      throw new Error("User authentication required: x-user-id header missing");
    }

    // Fetch user permissions
    const permissions = await getUserPermissions(userId);

    // Build disabled tools based on permissions
    const allOperations: OperationType[] = [
      "read",
      "metadata",
      "create",
      "update",
      "delete",
      "connect",
    ];

    const disabledOperations = allOperations.filter(
      (op) => !permissions.allowedOperations.includes(op)
    );

    // Return customized configuration for this session
    return {
      ...userConfig,
      disabledTools: disabledOperations,
      maxDocumentsPerQuery: permissions.maxDocuments,
      // Analysts get read-only access
      readOnly: permissions.role === "analyst",
    };
  };

// Initialize the server with session configuration hook
const runner = new StreamableHttpRunner({
  userConfig: baseConfig,
  createSessionConfig,
});

await runner.start();
console.log(
  `MongoDB MCP Server running with per-user permissions at ${runner.serverAddress}`
);
```

#### Example: Dynamic Connection String Selection

```typescript
import {
  UserConfigSchema,
  StreamableHttpRunner,
  type TransportRunnerConfig,
} from "mongodb-mcp-server";

// Connection strings for different environments
const connectionStrings = {
  production: process.env.MONGODB_PRODUCTION_URI,
  staging: process.env.MONGODB_STAGING_URI,
  development: process.env.MONGODB_DEV_URI,
};

const createSessionConfig: TransportRunnerConfig["createSessionConfig"] =
  async ({ userConfig, request }) => {
    // Get environment from request header
    const environment = request?.headers?.[
      "x-environment"
    ] as keyof typeof connectionStrings;

    if (!environment || !connectionStrings[environment]) {
      throw new Error("Invalid or missing x-environment header");
    }

    return {
      ...userConfig,
      connectionString: connectionStrings[environment],
      // Production is read-only
      readOnly: environment === "production",
    };
  };

const runner = new StreamableHttpRunner({
  userConfig: UserConfigSchema.parse({
    transport: "http",
    httpPort: 3000,
    httpHost: "127.0.0.1",
  }),
  createSessionConfig,
});

await runner.start();
console.log(
  `MongoDB MCP Server running with dynamic connection selection at ${runner.serverAddress}`
);
```

#### Example: Integration with Request Overrides

The library supports request-level configuration overrides when `allowRequestOverrides` is enabled. You can combine this with `createSessionConfig` for fine-grained control:

```typescript
import {
  applyConfigOverrides,
  UserConfigSchema,
  StreamableHttpRunner,
  type UserConfig,
  type TransportRunnerConfig,
} from "mongodb-mcp-server";

// Example interface for user roles and permissions
interface UserPermissions {
  role: "admin" | "developer" | "analyst";
  requestOverridesAllowed: boolean;
}

// Mock function to fetch user permissions (replace with your auth logic)
async function getUserPermissions(userId: string): Promise<UserPermissions> {
  const userDb = {
    "user-123": {
      role: "analyst",
      requestOverridesAllowed: false,
    },
    "user-456": {
      role: "developer",
      requestOverridesAllowed: true,
    },
    "user-789": {
      role: "admin",
      requestOverridesAllowed: true,
    },
  } as Record<string, UserPermissions>;

  return (
    userDb[userId] || {
      role: "analyst",
      requestOverridesAllowed: false,
    }
  );
}

// Base configuration for all sessions
const baseConfig = UserConfigSchema.parse({
  transport: "http",
  httpPort: 3000,
  httpHost: "127.0.0.1",
});

const createSessionConfig: TransportRunnerConfig["createSessionConfig"] =
  async ({ userConfig, request }) => {
    if (!request) {
      throw new Error("User authentication required: no headers provided");
    }

    // Extract user ID from request headers
    const userId = request.headers?.["x-user-id"];

    if (typeof userId !== "string") {
      throw new Error("User authentication required: x-user-id header missing");
    }

    // Fetch user permissions
    const permissions = await getUserPermissions(userId);

    // Generate a base config based on the user permissions
    const roleBasedConfig: UserConfig = {
      ...baseConfig,
      allowRequestOverrides: permissions.requestOverridesAllowed,
    };

    // Now attempt to apply the overrides. For roles where overrides are not
    // allowed, the default override application function will throw and reject
    // the initialization request.
    return applyConfigOverrides({ baseConfig: roleBasedConfig, request });
  };

const runner = new StreamableHttpRunner({
  userConfig: UserConfigSchema.parse({
    transport: "http",
    httpPort: 3000,
    httpHost: "127.0.0.1",
    // For this particular example, setting `allowRequestOverrides` here is
    // optional because if you notice the session configuration hook, we're
    // constructing the `roleBasedConfig` with the appropriate value of
    // `allowRequestOverrides` already before calling the exported
    // `applyConfigOverrides` function.
    //
    // Here we still pass it anyways to show an example that the
    // `allowRequestOverrides` can also be statically turned on during server
    // initialization.
    allowRequestOverrides: true,
    connectionString: process.env.MDB_MCP_CONNECTION_STRING,
  }),
  createSessionConfig,
});

await runner.start();
console.log(
  `MongoDB MCP Server running with role-based request overrides at ${runner.serverAddress}`
);
```

### Use Case 3: Adding Custom Tools

Extend the MCP server with custom tools tailored to your application's needs.

#### Example: Connection Selector Tool

This example shows how to create a custom tool that provides users with a list of pre-configured database connections:

```typescript
import { z } from "zod";
import {
  StdioRunner,
  UserConfigSchema,
  type UserConfig,
} from "mongodb-mcp-server";
import {
  ToolBase,
  type ToolCategory,
  type OperationType,
} from "mongodb-mcp-server/tools";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Define available connections
const AVAILABLE_CONNECTIONS = {
  "prod-analytics": {
    name: "Production Analytics",
    connectionString: process.env.MONGODB_PROD_ANALYTICS_URI!,
    description: "Production analytics database (read-only)",
    readOnly: true,
  },
  "staging-main": {
    name: "Staging Main",
    connectionString: process.env.MONGODB_STAGING_URI!,
    description: "Staging environment database",
    readOnly: false,
  },
  "dev-local": {
    name: "Development Local",
    connectionString: "mongodb://localhost:27017/dev",
    description: "Local development database",
    readOnly: false,
  },
};

// Custom tool to list available connections. We are expecting LLM to call this
// tool to make user aware of possible connections the MCP server could be
// connected to.
class ListConnectionsTool extends ToolBase {
  override name = "list-connections";
  static category: ToolCategory = "mongodb";
  static operationType: OperationType = "metadata";
  public override description =
    "Lists all available pre-configured MongoDB connections";
  public override argsShape = {};

  protected override async execute(): Promise<CallToolResult> {
    // Ensure that we don't leak the actual connection strings to the model
    // context.
    const connections = Object.entries(AVAILABLE_CONNECTIONS).map(
      ([id, conn]) => ({
        id,
        name: conn.name,
        description: conn.description,
        readOnly: conn.readOnly,
      })
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(connections),
        },
      ],
    };
  }

  // We don't want to report any telemetry for this tool so leaving it empty.
  protected override resolveTelemetryMetadata() {
    return {};
  }
}

// Custom tool to select a specific connection. Once user is made aware of list
// of connections, they can mention the name of the connection and LLM is then
// expected to call this tool with the name of the connection and the tool will
// internally connect to the pre-configured connection string. Notice how we
// never leak any connection details in the LLM context and maintain the
// effective communication using opaque connection identifiers.
class SelectConnectionTool extends ToolBase {
  override name = "select-connection";
  static category: ToolCategory = "mongodb";
  static operationType: OperationType = "metadata";
  public override description =
    "Select and connect to a pre-configured MongoDB connection by ID";
  public override argsShape = {
    connectionId: z
      .enum(Object.keys(AVAILABLE_CONNECTIONS) as [string, ...string[]])
      .describe("The ID of the connection to select"),
  };

  protected override async execute(args: {
    connectionId: string;
  }): Promise<CallToolResult> {
    const { connectionId } = args;
    const connection = AVAILABLE_CONNECTIONS[connectionId];

    if (!connection) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Connection '${connectionId}' not found. Use the list-connections tool to see available connections.`,
          },
        ],
        isError: true,
      };
    }

    try {
      // Disconnect from current connection if any
      await this.session.disconnect();

      // Connect to the new connection using the MongoDB MCP's own
      // ConnectionManager. The inbuilt connection manager is capable of
      // handling all the connection related task as long as we are able to
      // provide a `ConnectionInfo` like object to connect.
      await this.session.connectionManager.connect({
        connectionString: connection.connectionString,
      });

      return {
        content: [
          {
            type: "text",
            text: `Successfully switched to connection '${
              connection.name
            }' (${connectionId})${
              connection.readOnly ? " in READ-ONLY mode" : ""
            }.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to switch to connection '${connectionId}': ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  }

  // We don't want to report any telemetry for this tool so leaving it empty.
  protected override resolveTelemetryMetadata() {
    return {};
  }
}

// Initialize the server with custom tools alongside internal tools
const runner = new StdioRunner({
  userConfig: UserConfigSchema.parse({
    transport: "stdio",
    // Don't provide a default connection string
    connectionString: undefined,
  }),
  // Register all internal tools except the default connect tools, plus our custom tools
  tools: [
    ...AllTools.filter((tool) => tool.operationType !== "connect"),
    ListConnectionsTool,
    SelectConnectionTool,
  ],
});

await runner.start();
console.log(
  `MongoDB MCP Server running with custom connection selector tools at ${runner.serverAddress}`
);
```

### Use Case 4: Selective Tool Registration

Register only specific internal MongoDB tools alongside custom tools, giving you complete control over the available toolset.

#### Example: Minimal Toolset with Custom Integration

This example shows how to selectively enable only specific MongoDB tools (`aggregate`, `connect`, and `switch-connection`) while disabling all others, and adding a custom tool for application-specific functionality:

```typescript
import { z } from "zod";
import { StreamableHttpRunner, UserConfigSchema } from "mongodb-mcp-server";
import {
  type ToolCategory,
  type OperationType,
  AllTools,
  ToolBase,
} from "mongodb-mcp-server/tools";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Custom tool to fetch ticket details from your application
class GetTicketDetailsTool extends ToolBase {
  override name = "get-ticket-details";
  static category: ToolCategory = "mongodb";
  static operationType: OperationType = "read";

  public override description =
    "Retrieves detailed information about a support ticket from the tickets collection";

  public override argsShape = {
    ticketId: z.string().describe("The unique identifier of the ticket"),
  };

  protected override async execute(args: {
    ticketId: string;
  }): Promise<CallToolResult> {
    const { ticketId } = args;

    try {
      // Ensure connected to MongoDB
      await this.session.ensureConnected();

      // Fetch ticket from the database
      const ticket = await this.session.db
        .collection("tickets")
        .findOne({ ticketId });

      if (!ticket) {
        return {
          content: [
            {
              type: "text",
              text: `No ticket found with ID: ${ticketId}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(ticket, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching ticket: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  }

  protected override resolveTelemetryMetadata() {
    return {};
  }
}

// Select only the specific internal tools we want to keep
const selectedInternalTools = [
  AllTools.AggregateTool,
  AllTools.ConnectTool,
  AllTools.SwitchConnectionTool,
];

// Initialize the server with minimal toolset
const runner = new StreamableHttpRunner({
  userConfig: UserConfigSchema.parse({
    transport: "http",
    httpPort: 3000,
    httpHost: "127.0.0.1",
    connectionString: process.env.MDB_MCP_CONNECTION_STRING,
  }),
  // Register only selected internal tools plus our custom tool
  tools: [...selectedInternalTools, GetTicketDetailsTool],
});

await runner.start();
console.log(
  `MongoDB MCP Server running with minimal toolset at ${runner.serverAddress}`
);
```

In this configuration:

- The server will **only** register three internal MongoDB tools: `aggregate`, `connect`, and `switch-connection`
- All other internal tools (find, insert, update, etc.) are not registered at all
- The custom `get-ticket-details` tool provides application-specific functionality
- Atlas and Atlas Local tools are not registered since they're not in the `tools` array

This approach is useful when you want to:

- Create a focused MCP server for a particular use case
- Limit LLM capabilities to specific operations
- Combine selective internal tools with domain-specific custom tools

## API Reference

### TransportRunnerConfig

Configuration options for initializing transport runners (`StdioRunner`, `StreamableHttpRunner`).

See the TypeScript definition in [`src/transports/base.ts`](./src/transports/base.ts) for detailed documentation of all available options.

### ToolBase

Base class for implementing custom MCP tools.

See the TypeScript documentation in [`src/tools/tool.ts`](./src/tools/tool.ts) for:

- Detailed explanation of `ToolBase` abstract class
- Documentation of all available protected members
- Information about required abstract properties (`name`, `category`) and required static property (`operationType`)

**Important:** All custom tools must conform to the `ToolClass` type, which requires:

- **Static** `category` and `operationType` properties (not instance properties)
- Implementation of all abstract members from `ToolBase`

### ToolClass

The type that all tool classes must conform to when implementing custom tools.

This type enforces that tool classes have:

- A constructor that accepts `ToolConstructorParams`
- **Static** `category` and `operationType` properties

The static properties are automatically injected as instance properties during tool construction by the server.

See the TypeScript documentation in [`src/tools/tool.ts`](./src/tools/tool.ts) for complete details and examples.

### Tool Collections

The library exports collections of internal tool classes that can be used for selective tool registration or extension.

```typescript
import { AllTools, AggregateTool, FindTool } from "mongodb-mcp-server/tools";

// Use all internal tools
// An array containing all internal tool constructors (MongoDB, Atlas, and Atlas Local tools combined).
const allTools = AllTools;

// Pick specific tools by importing them directly
const selectedInternalTools = [AggregateTool, FindTool];

// Create a list of all internal tools except a few by filtering
const filteredTools = AllTools.filter(
  (tool) => tool !== AggregateTool && tool !== FindTool
);

// Filter tools by operationType (static property)
const connectionRelatedTools = AllTools.filter(
  (tool) => tool.operationType === "connect"
);

// Filter tools by category
const mongodbTools = AllTools.filter((tool) => tool.category === "mongodb");
const atlasTools = AllTools.filter((tool) => tool.category === "atlas");
const atlasLocalTools = AllTools.filter(
  (tool) => tool.category === "atlas-local"
);
```

### UserConfig

Server configuration options. See the [Configuration Options](README.md#configuration-options) section in the main README for a complete list of available configuration fields.

### UserConfigSchema

Zod schema for validating and creating UserConfig objects with default values. This is useful when you want to create a base configuration without parsing CLI arguments or environment variables.

```typescript
import { UserConfigSchema } from "mongodb-mcp-server";

// Create a config with all default values
const defaultConfig = UserConfigSchema.parse({});

// Create a config with some custom values, rest will be defaults
const customConfig = UserConfigSchema.parse({
  transport: "http",
  httpPort: 8080,
  readOnly: true,
});
```

This approach ensures you get all the default values without having to specify every configuration key manually.

### parseUserConfig

Utility function to parse command-line arguments and environment variables into a UserConfig object, using the same parsing logic as the MongoDB MCP server CLI.

_Note: This is what MongoDB MCP server uses internally._

**Example:**

```typescript
import {
  parseUserConfig,
  StdioRunner,
  UserConfigSchema,
} from "mongodb-mcp-server";

// Parse config from process.argv and environment variables
const config = parseUserConfig({
  args: process.argv.slice(2),
  // You can optionally specify overrides for the config
  // This can be used, for example, to set new defaults.
  overrides: {
    readOnly: UserConfigSchema.shape.readOnly.default(true),
  },
});

const runner = new StdioRunner({ userConfig: config });
await runner.start();
```

### applyConfigOverrides

Utility function to manually apply request-based configuration overrides.

_Note: This is what MongoDB MCP server uses internally._

```typescript
function applyConfigOverrides(params: {
  baseConfig: UserConfig;
  request?: RequestContext;
}): UserConfig;
```

See "Example: Integration with Request Overrides" for further details on how to use this function.

## Advanced Topics

### Custom Connection Management

You can provide a custom connection manager factory to control how the MongoDB MCP server connects to a MongoDB instance. The only use case for this is if connection handling is done differently in your application. For example, the [MongoDB extension for VS Code](https://github.com/mongodb-js/vscode/blob/f45a4c774ffc01e9aed38f6ef00224bf921d9784/src/mcp/mcpConnectionManager.ts#L30) provides its own implementation of ConnectionManager because the connection handling is done by the extension itself.

The default connection manager factory (`createMCPConnectionManager`) is also exported if you need to use the default implementation.

```typescript
import {
  ConnectionManager,
  StreamableHttpRunner,
  UserConfigSchema,
  createMCPConnectionManager,
} from "mongodb-mcp-server";
import type { ConnectionManagerFactoryFn } from "mongodb-mcp-server";

// Using the default connection manager (this is the default behavior)
const runner1 = new StreamableHttpRunner({
  userConfig: UserConfigSchema.parse({}),
  createConnectionManager: createMCPConnectionManager,
});

// Or provide a custom connection manager
const customConnectionManager: ConnectionManagerFactoryFn = async ({
  logger,
  userConfig,
  deviceId,
}): Promise<ConnectionManager> => {
  // Just for types we're using the internal mcp connection manager factory but
  // its an example. You can return a custom ConnectionManager implementation
  // that could delegate to your application's existing connection logic.
  return createMCPConnectionManager({ logger, userConfig, deviceId });
};

const runner2 = new StreamableHttpRunner({
  userConfig: UserConfigSchema.parse({}),
  createConnectionManager: customConnectionManager,
});
```

### Custom Error Handling

Provide custom error handling for connection errors. The error handler receives `MongoDBError` instances with specific error codes, and can choose to handle them or let the default handler take over.

The default connection error handler (`connectionErrorHandler`) is also exported if you need to use the default implementation.

**Error Types:**

The error handler receives `MongoDBError` instances with one of the following error codes:

- `ErrorCodes.NotConnectedToMongoDB` - Thrown when a tool requires a connection but none exists
- `ErrorCodes.MisconfiguredConnectionString` - Thrown when the connection string provided through `UserConfig` is invalid

**ConnectionErrorHandlerContext:**

```typescript
interface ConnectionErrorHandlerContext {
  /** List of all available tools that can be suggested to the user */
  availableTools: ToolBase[];
  /** Current state of the connection manager */
  connectionState: AnyConnectionState;
}
```

**Example:**

```typescript
import {
  StreamableHttpRunner,
  UserConfigSchema,
  ErrorCodes,
  connectionErrorHandler as defaultConnectionErrorHandler,
} from "mongodb-mcp-server";
import type { ConnectionErrorHandler } from "mongodb-mcp-server";

// Using the default error handler (this is the default behavior)
const runner1 = new StreamableHttpRunner({
  userConfig: UserConfigSchema.parse({}),
  connectionErrorHandler: defaultConnectionErrorHandler,
});

// Or provide a custom error handler
const customErrorHandler: ConnectionErrorHandler = (error, context) => {
  // error is a MongoDBError with specific error codes
  console.error("Connection error:", error.code, error.message);

  // Access available tools and connection state
  const connectTools = context.availableTools
    .filter((t) => t.operationType === "connect")
    .map((tool) => tool.name)
    .join(", ");

  if (error.code === ErrorCodes.NotConnectedToMongoDB) {
    // Provide custom error message
    return {
      errorHandled: true,
      result: {
        content: [
          {
            type: "text",
            text: `Please connect to MongoDB first using one of the available connect tools - (${connectTools})`,
          },
        ],
        isError: true,
      },
    };
  }

  // Delegate to default handler for other errors
  return defaultConnectionErrorHandler(error, context);
};

const runner2 = new StreamableHttpRunner({
  userConfig: UserConfigSchema.parse({}),
  connectionErrorHandler: customErrorHandler,
});
```

### Custom Logging

Add custom loggers to capture server events:

```typescript
import {
  StreamableHttpRunner,
  LoggerBase,
  UserConfigSchema,
  Keychain,
  type LogPayload,
  type LogLevel,
  type LoggerType,
} from "mongodb-mcp-server";

class CustomLogger extends LoggerBase {
  // Optional: specify the logger type for redaction control
  protected readonly type: LoggerType = "console";

  constructor() {
    // Pass keychain for automatic secret redaction
    // Use Keychain.root for the global keychain or create your own
    super(Keychain.root);
  }

  // Required: implement the core logging method
  protected logCore(level: LogLevel, payload: LogPayload): void {
    // Send to your logging service
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] [${payload.id}] ${payload.context}: ${payload.message}`;

    // Example: Send to external logging service
    console.log(logMessage);

    // You can also access payload.attributes for additional context
    if (payload.attributes) {
      console.log("  Attributes:", JSON.stringify(payload.attributes));
    }
  }
}

const runner = new StreamableHttpRunner({
  userConfig: UserConfigSchema.parse({}),
  additionalLoggers: [new CustomLogger()],
});
```

## Examples

For complete working examples of embedding and extending the MongoDB MCP Server, refer to:

- **Use Case Examples**: See the detailed examples in the [Use Cases](#use-cases) section above
- **MongoDB VS Code Extension**: Real-world integration of MongoDB MCP server in our extension at [mongodb-js/vscode](https://github.com/mongodb-js/vscode)

## Best Practices

### Security

1. **Never expose connection strings or API credentials in logs or error messages**
2. **Apply the principle of least privilege when creating session configuration**
3. **Ensure only expected HTTP header and query parameters overrides are applied**
4. **Validate all inputs in custom tools**

### Performance

1. **Set appropriate `maxDocumentsPerQuery` and `maxBytesPerQuery` limits as this might affect runtime memory usage**
2. **Use `indexCheck: true` to ensure only indexed queries are run by the server**

### Development

1. **Test custom tools thoroughly before deployment**
2. **Implement comprehensive error handling in custom tools**

## Troubleshooting

### Common Issues

**Problem:** Custom tools not appearing in the tool list

- **Solution:** Ensure the tool class extends `ToolBase` and is passed in the `tools` array
- **Solution:** If you want both internal and custom tools, spread `AllTools` in the array: `tools: [...AllTools, MyCustomTool]`
- **Solution:** Check that the tool's `verifyAllowed()` returns true and the tool is not accidentally disabled by config (disabledTools)

**Problem:** Configuration overrides not working

- **Solution:** Enable `allowRequestOverrides: true` in the base configuration
- **Solution:** Check that the configuration field allows overrides (see `overrideBehavior` in schema)

**Problem:** Tool name collision error

- **Solution:** Ensure your custom tools have unique names that don't conflict with built-in tools
- **Solution:** Check the list of built-in tool names in the [Supported Tools](README.md#supported-tools) section

## Support

For issues, questions, or contributions, please refer to the main [Contributing Guide](CONTRIBUTING.md) and open an issue on [GitHub](https://github.com/mongodb-js/mongodb-mcp-server).
