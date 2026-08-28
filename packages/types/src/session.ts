import type { ICompositeLogger } from "./logging.js";
import type { IKeychain } from "./keychain.js";
import type { IToolConfig } from "./config.js";

/**
 * The minimal server-scoped surface tools and resources rely on: config,
 * logging, and secret redaction.
 *
 * The server is deliberately stateless: MongoDB connection state lives in the
 * app-level connection store and is addressed per request by `connectionId`,
 * and per-client identity (name/version/title) travels on the tool request
 * (see `ToolExecutionContext.clientInfo`) rather than on a mutable server
 * object. Tool categories extend this interface with the specific app-level
 * services they need.
 */
export interface ISession<TConfig extends IToolConfig = IToolConfig> {
    /** Configuration for the server */
    readonly config: TConfig;
    /** Logger for the server */
    readonly logger: ICompositeLogger;
    /** Keychain for secret management */
    readonly keychain: IKeychain;
}
