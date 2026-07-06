import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import { CreateDBUserTool, CreateDBUserArgs } from "./createDBUser.js";
import type { IAtlasSession, IAtlasConfig } from "../../atlasTool.js";
import type { ITelemetry, IElicitation, ICompositeLogger } from "@mongodb-js/mcp-types";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { MockMetrics } from "../../mockMetrics.js";
import { Keychain } from "@mongodb-js/mcp-core";

vi.mock("../../helpers/accessListUtils.js", () => ({
    ensureCurrentIpInAccessList: vi.fn().mockResolvedValue(false),
    DEFAULT_ACCESS_LIST_COMMENT: "Added by MongoDB MCP Server to enable tool access",
}));

vi.mock("../../helpers/generatePassword.js", () => ({
    generateSecurePassword: vi.fn().mockResolvedValue("generated-password"),
}));

describe("CreateDBUserTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let keychain: Keychain;
    let registerSpy: ReturnType<typeof vi.spyOn>;
    let tool: CreateDBUserTool;

    const baseArgs = {
        projectId: "507f1f77bcf86cd799439011",
        username: "test-user",
        roles: [{ roleName: "readWrite", databaseName: "admin" }],
    };

    beforeEach(() => {
        keychain = new Keychain();
        registerSpy = vi.spyOn(keychain, "register");
        mockApiClient = {
            createDatabaseUser: vi.fn().mockResolvedValue({}),
        };

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
            setAttribute: vi.fn(),
            addLogger: vi.fn(),
        } as unknown as ICompositeLogger;

        const mockSession = {
            sessionId: "test-session",
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            connectedAtlasCluster: undefined,
            connectToMongoDB: vi.fn().mockResolvedValue(undefined),
            keychain,
            config: {
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
            } as unknown as IAtlasConfig,
            disconnect: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            isConnectedToMongoDB: false,
            on: vi.fn(),
            setMcpClient: vi.fn(),
        } as unknown as IAtlasSession;

        const params: ToolConstructorParams<IAtlasSession> = {
            name: CreateDBUserTool.toolName,
            category: "atlas",
            operationType: CreateDBUserTool.operationType,
            session: mockSession,
            telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as ITelemetry,
            elicitation: { requestConfirmation: vi.fn() } as unknown as IElicitation,
            metrics: new MockMetrics(),
        };

        tool = new CreateDBUserTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = baseArgs) =>
        tool["execute"](args as never, { signal: new AbortController().signal } as never);

    it("creates a user with a supplied password", async () => {
        const result = await exec({ ...baseArgs, password: "user-password" });

        expect((result.content[0] as { text: string }).text).toBe('User "test-user" created successfully.');
        expect(registerSpy).toHaveBeenCalledWith("test-user", "user");
        expect(registerSpy).toHaveBeenCalledWith("user-password", "password");
        expect(result.structuredContent).toEqual({
            username: baseArgs.username,
        });
    });

    it("generates a password when none is supplied", async () => {
        const result = await exec();

        expect((result.content[0] as { text: string }).text).toContain("with password: `generated-password`");
        expect(registerSpy).toHaveBeenCalledWith("generated-password", "password");
        expect(result.structuredContent).toEqual({
            username: baseArgs.username,
            password: "generated-password",
        });
    });

    it("passes cluster scopes to the API when clusters are provided", async () => {
        await exec({ ...baseArgs, clusters: ["cluster-a", "cluster-b"] });

        expect(mockApiClient.createDatabaseUser).toHaveBeenCalledOnce();
        const call = mockApiClient.createDatabaseUser?.mock.calls[0]?.[0] as { body: Record<string, unknown> };
        expect(call.body).toMatchObject({
            scopes: [
                { type: "CLUSTER", name: "cluster-a" },
                { type: "CLUSTER", name: "cluster-b" },
            ],
        });
    });

    describe("roleName validation", () => {
        const rolesSchema = z.object(CreateDBUserArgs).shape.roles;

        it.each(["atlasAdmin", "readWrite", "readAnyDatabase"])("accepts the built-in role %s", (roleName) => {
            expect(rolesSchema.safeParse([{ roleName, databaseName: "admin" }]).success).toBe(true);
        });

        it("accepts an alphanumeric custom role name", () => {
            expect(rolesSchema.safeParse([{ roleName: "my_custom-role1", databaseName: "admin" }]).success).toBe(true);
        });

        it.each(["atlasAdmin`<!--", "read*write*", "admin|role", "<b>read</b>", "role name"])(
            "rejects a role name containing markdown/HTML metacharacters: %j",
            (roleName) => {
                expect(rolesSchema.safeParse([{ roleName, databaseName: "admin" }]).success).toBe(false);
            }
        );
    });

    describe("getConfirmationMessage", () => {
        it("escapes markdown metacharacters in role database and collection names", () => {
            const message = tool["getConfirmationMessage"]({
                ...baseArgs,
                roles: [{ roleName: "readWrite", databaseName: "db<!--hidden", collectionName: "col*bold*" }],
            } as never);

            expect(message).not.toContain("db<!--hidden");
            expect(message).not.toContain("col*bold*");
            expect(message).toContain("db\\<\\!\\-\\-hidden");
            expect(message).toContain("col\\*bold\\*");
        });
    });

    describe("structuredContent", () => {
        it("omits the password when the user supplies one", async () => {
            const result = await exec({
                ...baseArgs,
                password: "secret",
            });

            expect(result.structuredContent).toEqual({
                username: baseArgs.username,
            });
        });

        it("includes the generated password when one is created", async () => {
            const result = await exec();

            expect(result.structuredContent).toEqual({
                username: baseArgs.username,
                password: "generated-password",
            });
        });
    });
});
