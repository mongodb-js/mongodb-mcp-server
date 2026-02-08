import type { UserConfig } from "../../common/config/userConfig.js";
import type { ApiClientFactoryFn } from "../../common/atlas/apiClient.js";
import type { AtlasLocalClientFactoryFn } from "../../common/atlasLocal.js";
import type { ConnectionErrorHandler } from "../../common/connectionErrorHandler.js";
import type { ConnectionManagerFactoryFn } from "../../common/connectionManager.js";
import type { CommonTransportRunnerConfig } from "./commonConfig.js";

export type RequestContext = {
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
};

/**
 * A function to dynamically generate `UserConfig` object, potentially unique to
 * each MCP client session.
 *
 * The function is passed a config context object containing:
 * 1. `userConfig`: The base `UserConfig` object that MongoDB MCP Server was
 *    started with, either through parsed CLI arguments or a static
 *    configuration injected through `TransportRunnerConfig`
 * 2. `request`: An optional, `RequestContext` object, available only when
 *    MongoDB MCP server is running over HTTP transport, that contains headers
 *    and query parameters received in MCP session initialization object.
 *
 * @see {@link UserConfig} to inspect the properties available on `userConfig`
 * object.
 * @see {@link RequestContext} to inspect the properties available on
 * `requestContext` object.
 */
export type CreateSessionConfigFn = (context: {
    userConfig: UserConfig;
    request?: RequestContext;
}) => Promise<UserConfig> | UserConfig;

/**
 * Configuration options for customizing how transport runners are initialized.
 * This includes specifying the base user configuration, providing custom
 * connection management, and other advanced options.
 *
 * You may want to customize this configuration if you need to:
 * - Provide a custom user configuration for different environments or users.
 * - Override the default connection management to MongoDB deployments.
 * - Provide a specific list of tools to be registered with the MCP server.
 *
 * In most cases, just providing the `UserConfig` object is sufficient, but
 * advanced use-cases (such as embedding the MCP server in another application
 * or supporting custom authentication flows) may require customizing other
 * `TransportRunnerConfig` options as well.
 */
export type LegacyTransportRunnerConfig = CommonTransportRunnerConfig & {
    /**
     * An optional factory function to generates an instance of
     * `ConnectionManager`. When not provided, MongoDB MCP Server uses an
     * internal implementation to manage connection to MongoDB deployments.
     *
     * Customize this only if the use-case involves handling the MongoDB
     * connections differently and outside of MongoDB MCP server.
     */
    createConnectionManager?: ConnectionManagerFactoryFn;

    /**
     * An optional function to handle connection related errors. When not
     * provided, MongoDB MCP Server uses an internal implementation to handle
     * the errors raised by internal implementation of `ConnectionManager`
     * class.
     *
     * Customize this only if you need to handle the Connection errors different
     * from the internal implementation or if you have provided a different
     * implementation of `ConnectionManager` that might raise errors unknown to
     * default internal connection error handler.
     */
    connectionErrorHandler?: ConnectionErrorHandler;

    /**
     * An optional factory function to create a client for working with Atlas
     * local deployments. When not provided, MongoDB MCP Server uses an internal
     * implementation to create the local Atlas client.
     */
    createAtlasLocalClient?: AtlasLocalClientFactoryFn;

    /**
     * An optional function to hook into session configuration lifecycle and
     * provide session specific configuration (`UserConfig`).
     *
     * The function is called before each session is created, allowing you to:
     * - Fetch configuration from external sources (secrets managers, APIs)
     * - Apply user-specific permissions and limits
     * - Modify connection strings dynamically
     * - Validate authentication credentials
     *
     * This function is called for each new MCP client connection. For stdio
     * transport, this is called once at server startup. For HTTP transport,
     * this is called for each new session.
     */
    createSessionConfig?: CreateSessionConfigFn;

    /**
     * An optional factory function to generates an instance of
     * `ApiClient`. When not provided, MongoDB MCP Server uses an
     * internal implementation to create the API client.
     *
     * Customize this only if the use-case involves handling the API client
     * differently and outside of MongoDB MCP server.
     */
    createApiClient?: ApiClientFactoryFn;
};
