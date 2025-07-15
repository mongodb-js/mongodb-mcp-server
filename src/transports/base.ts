import { config } from "../common/config.js";
import { packageInfo } from "../common/packageInfo.js";
import { Server } from "../server.js";
import { Session } from "../common/session.js";
import { Telemetry } from "../telemetry/telemetry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export abstract class Runner {
    protected setupServer(): Server {
        const session = new Session({
            apiBaseUrl: config.apiBaseUrl,
            apiClientId: config.apiClientId,
            apiClientSecret: config.apiClientSecret,
        });

        const telemetry = Telemetry.create(session, config);

        const mcpServer = new McpServer({
            name: packageInfo.mcpServerName,
            version: packageInfo.version,
        });

        return new Server({
            mcpServer,
            session,
            telemetry,
            userConfig: config,
        });
    }

    abstract run(): Promise<void>;

    abstract close(): Promise<void>;
}
