# V2 Migration Guide

## Positional parameters replaced with options objects

All constructors now take a single options object instead of positional arguments.

### `LoggerBase`

```diff
- const logger = new LoggerBase(keychain);
+ const logger = new LoggerBase({ keychain });
```

Classes extending `LoggerBase` must update their `super()` calls accordingly.

### `ConsoleLogger`

```diff
- const logger = new ConsoleLogger(keychain);
+ const logger = new ConsoleLogger({ keychain });
```

### `DiskLogger`

```diff
- const logger = new DiskLogger(logPath, onError, keychain);
+ const logger = new DiskLogger({ logPath, onError, keychain });
```

### `McpLogger`

`McpLogger` now accepts an `McpServer` (from `@mongodb-js/mcp-core`) directly, plus a `mcpLogLevel` (static value or getter function).

```diff
- const logger = new McpLogger(server, keychain);
+ const logger = new McpLogger({
+     server: mcpServer,
+     mcpLogLevel: () => server.mcpLogLevel,
+     keychain,
+ });
```

## Atlas API client extracted to `@mongodb-js/mcp-atlas-api-client`

`ApiClient`, `ApiClientError`, `AuthProvider`, OpenAPI types, and related exports have moved from `mongodb-mcp-server` internals to the new `@mongodb-js/mcp-atlas-api-client` package.

### Import paths

```diff
- import { ApiClient, defaultCreateApiClient } from "mongodb-mcp-server";
+ import { ApiClient, createDefaultApiClient } from "@mongodb-js/mcp-atlas-api-client";

- import { ApiClientError } from "../../common/atlas/apiClientError.js";
+ import { ApiClientError } from "@mongodb-js/mcp-atlas-api-client";

- import type { AuthProvider, Credentials } from "../../common/atlas/auth/authProvider.js";
+ import type { AuthProvider, Credentials } from "@mongodb-js/mcp-atlas-api-client";

- import type { Group } from "../../common/atlas/openapi.js";
+ import type { Group } from "@mongodb-js/mcp-atlas-api-client";
```

### `defaultCreateApiClient` renamed to `createDefaultApiClient`

```diff
- defaultCreateApiClient(options, logger)
+ createDefaultApiClient(options)
```

### `ApiClient` constructor: single options object

The constructor now takes a single options object. `logger` and `authProvider` move into options.

```diff
- const client = new ApiClient({ baseUrl, credentials }, logger, authProvider);
+ const client = new ApiClient({ baseUrl, userAgent, credentials, logger, authProvider });
```

### `userAgent` is now required

Previously `userAgent` was optional and defaulted to a string built from `packageInfo`. Callers must now provide it explicitly.

```diff
- const client = new ApiClient({ baseUrl }, logger);
+ const client = new ApiClient({ baseUrl, userAgent: `MyApp/1.0`, logger });
```

### `ApiClientFactoryFn` signature changed

```diff
- type ApiClientFactoryFn = (options: ApiClientOptions, logger: LoggerBase) => ApiClient;
+ type ApiClientFactoryFn = (options: ApiClientOptions) => ApiClient;
```

### `sendEvents` uses an options object

```diff
- await client.sendEvents(events, { signal });
+ await client.sendEvents({ events, signal });
```

The `events` parameter is now `unknown[]` (generic) instead of `TelemetryEvent<CommonProperties>[]`.

### OpenAPI types

Commonly used schema types are exported directly:

```ts
import type { Group, ClusterDescription20240805, DatabaseUserRole } from "@mongodb-js/mcp-atlas-api-client";
```

For less common types, use `components["schemas"]`:

```ts
import type { components } from "@mongodb-js/mcp-atlas-api-client";
type MyType = components["schemas"]["SomeSchemaName"];
```
