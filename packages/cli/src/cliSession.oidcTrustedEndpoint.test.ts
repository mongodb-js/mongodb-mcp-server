import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import { parseUserConfig } from "./config/parseUserConfig.js";
import { Session } from "./cliSession.js";
import { CompositeLogger, Keychain } from "@mongodb-js/mcp-core";
import { ApiClient, userAgentFromServerMetadata } from "@mongodb-js/mcp-atlas-api-client";
import { UserConfigSchema, type UserConfig } from "./config/userConfig.js";
import {
    ExportsManager,
    DeviceId,
    MCPConnectionStore,
    connectionErrorHandler,
    type ConnectionRegistry,
} from "@mongodb-js/mcp-tools-mongodb";
import type { ServerMetadata } from "@mongodb-js/mcp-types";

vi.mock("@mongosh/arg-parser", async (importOriginal) => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    const actual = await importOriginal<typeof import("@mongosh/arg-parser")>();
    return {
        ...actual,
        generateConnectionInfoFromCliArgs: vi.fn(actual.generateConnectionInfoFromCliArgs),
    };
});

const mockGenerateFn = vi.mocked(generateConnectionInfoFromCliArgs);

const serverMetadata: ServerMetadata = {
    mcpServerName: "test-server",
    version: "0.0.0",
};

const logger = new CompositeLogger();

function createSession(): { session: Session; registry: ConnectionRegistry } {
    const deviceId = DeviceId.create(logger);
    const userConfig: UserConfig = {
        ...UserConfigSchema.parse({}),
        telemetry: "disabled",
        loggers: ["stderr"],
    };
    const registry = new MCPConnectionStore({
        userConfig,
        logger,
        deviceId,
    }).view();

    const session = new Session({
        config: userConfig,
        logger,
        exportsManager: ExportsManager.init({ options: userConfig, logger }),
        connectionRegistry: registry,
        keychain: new Keychain(),
        connectionErrorHandler,
        apiClient: new ApiClient(
            {
                baseUrl: userConfig.apiBaseUrl,
                userAgent: userAgentFromServerMetadata(serverMetadata),
                httpClient: {
                    fetch: globalThis.fetch.bind(globalThis),
                    Request: globalThis.Request,
                },
            },
            logger
        ),
    });

    return { session, registry };
}

describe("Session (stateless) — MCP client and lifecycle", () => {
    beforeEach(() => {
        mockGenerateFn.mockClear();
    });

    it("records the MCP client info via setMcpClient", () => {
        const { session } = createSession();

        session.setMcpClient({
            name: "test-client",
            version: "1.2.3",
        });

        expect(session.mcpClient).toEqual({
            name: "test-client",
            version: "1.2.3",
            title: "unknown",
        });
    });

    it("falls back to unknown client info when setMcpClient is called without a client", () => {
        const { session } = createSession();

        session.setMcpClient(undefined);

        expect(session.mcpClient).toEqual({
            name: "unknown",
            version: "unknown",
            title: "unknown",
        });
    });

    it("close() closes the connection registry, api client and exports manager", async () => {
        const { session, registry } = createSession();
        const registryClose = vi.spyOn(registry, "close").mockResolvedValue(undefined);
        const apiClientClose = vi.spyOn(session.apiClient, "close").mockResolvedValue(undefined);
        const exportsManagerClose = vi.spyOn(session.exportsManager, "close").mockResolvedValue(undefined);
        const closeListener = vi.fn();
        session.on("close", closeListener);

        await session.close();

        expect(registryClose).toHaveBeenCalled();
        expect(apiClientClose).toHaveBeenCalled();
        expect(exportsManagerClose).toHaveBeenCalled();
        expect(closeListener).toHaveBeenCalled();
    });
});

describe("oidcTrustedEndpoint — CLI option propagation", () => {
    // parseUserConfig additionally merges MDB_MCP_-prefixed environment
    // variables; clear them so the CLI-args-only assertions below are
    // deterministic regardless of the host environment.
    let savedEnv: Record<string, string | undefined>;

    beforeEach(() => {
        mockGenerateFn.mockClear();
        savedEnv = Object.create(null) as Record<string, string | undefined>;
        for (const key of Object.keys(process.env)) {
            if (key.startsWith("MDB_MCP_")) {
                savedEnv[key] = process.env[key];
                delete process.env[key];
            }
        }
    });

    afterEach(() => {
        Object.assign(process.env, savedEnv);
    });

    it("passes oidcTrustedEndpoint from the CLI args into connection info generation", () => {
        const { parsed, error } = parseUserConfig({
            args: ["mongodb://localhost:27017/", "--oidcTrustedEndpoint"],
        });

        expect(error).toBeUndefined();
        expect(parsed).toBeDefined();
        expect(mockGenerateFn).toHaveBeenCalledWith(
            expect.objectContaining({
                oidcTrustedEndpoint: true,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                connectionSpecifier: expect.stringContaining("mongodb://localhost:27017/"),
            })
        );
    });

    it("does NOT pass oidcTrustedEndpoint when it is not configured", () => {
        parseUserConfig({
            args: ["mongodb://localhost:27017/"],
        });

        expect(mockGenerateFn).toHaveBeenCalledWith(expect.not.objectContaining({ oidcTrustedEndpoint: true }));
    });
});
