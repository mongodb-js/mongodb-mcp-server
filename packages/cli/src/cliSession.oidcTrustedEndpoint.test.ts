import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import type { ConnectionManager } from "@mongodb-js/mcp-tools-mongodb";
import { UserConfigSchema } from "./config/userConfig.js";
import type { CliSessionOptions } from "./cliSession.js";
import { CliSession } from "./cliSession.js";

vi.mock("@mongosh/arg-parser", async (importOriginal) => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    const actual = await importOriginal<typeof import("@mongosh/arg-parser")>();
    return {
        ...actual,
        generateConnectionInfoFromCliArgs: vi.fn(actual.generateConnectionInfoFromCliArgs),
    };
});

const mockGenerateFn = vi.mocked(generateConnectionInfoFromCliArgs);

function createTestSession(userConfig: ReturnType<typeof UserConfigSchema.parse>): CliSession {
    const connectionManager = {
        events: new EventEmitter(),
        connect: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConnectionManager;

    return new CliSession({
        userConfig,
        logger: {} as unknown as CliSessionOptions["logger"],
        exportsManager: {} as unknown as CliSessionOptions["exportsManager"],
        connectionManager,
        keychain: {} as unknown as CliSessionOptions["keychain"],
        connectionErrorHandler: {} as unknown as CliSessionOptions["connectionErrorHandler"],
        apiClient: {} as unknown as CliSessionOptions["apiClient"],
    });
}

describe("CliSession.connectToMongoDB() — mongosh CLI option propagation", () => {
    beforeEach(() => {
        mockGenerateFn.mockClear();
    });

    it("passes oidcTrustedEndpoint from userConfig when connecting", async () => {
        const userConfig = UserConfigSchema.parse({ oidcTrustedEndpoint: true });
        const session = createTestSession(userConfig);

        const connectionString = "mongodb://localhost:27017/";

        await session.connectToMongoDB({ connectionString }).catch(() => {});

        expect(mockGenerateFn).toHaveBeenCalledWith(
            expect.objectContaining({
                oidcTrustedEndpoint: true,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                connectionSpecifier: expect.stringContaining("mongodb://localhost:27017/"),
            })
        );
    });

    it("does NOT pass oidcTrustedEndpoint when it is not set in userConfig", async () => {
        const userConfig = UserConfigSchema.parse({});
        const session = createTestSession(userConfig);

        const connectionString = "mongodb://localhost:27017/";

        await session.connectToMongoDB({ connectionString }).catch(() => {});

        expect(mockGenerateFn).toHaveBeenCalledWith(expect.not.objectContaining({ oidcTrustedEndpoint: true }));
    });
});
