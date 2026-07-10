import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { CreateDBUserTool, CreateDBUserArgs } from "../../../../../src/tools/atlas/create/createDBUser.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";
import type { Keychain } from "../../../../../src/lib.js";
import { ensureCurrentIpInAccessList } from "../../../../../src/common/atlas/accessListUtils.js";

vi.mock("../../../../../src/common/atlas/accessListUtils.js", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    ensureCurrentIpInAccessList: vi.fn(),
}));

vi.mock("../../../../../src/helpers/generatePassword.js", () => ({
    generateSecurePassword: vi.fn().mockResolvedValue("generated-password"),
}));

describe("CreateDBUserTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let register: ReturnType<typeof vi.fn>;
    let tool: CreateDBUserTool;

    const baseArgs = {
        projectId: "507f1f77bcf86cd799439011",
        username: "test-user",
        roles: [{ roleName: "readWrite", databaseName: "admin" }],
    };

    beforeEach(() => {
        vi.mocked(ensureCurrentIpInAccessList).mockResolvedValue("added");
        register = vi.fn();
        mockApiClient = {
            createDatabaseUser: vi.fn().mockResolvedValue({}),
        };

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        const mockSession = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            keychain: { register, allSecrets: [] } as unknown as Keychain,
        } as unknown as Session;

        const params: ToolConstructorParams = {
            name: CreateDBUserTool.toolName,
            category: "atlas",
            operationType: CreateDBUserTool.operationType,
            session: mockSession,
            config: {
                confirmationRequiredTools: [],
                previewFeatures: [],
                disabledTools: [],
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
            } as unknown as UserConfig,
            telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as Telemetry,
            elicitation: { requestConfirmation: vi.fn() } as unknown as Elicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new CreateDBUserTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = baseArgs) =>
        tool["execute"](args as never, { signal: new AbortController().signal } as never);

    it("creates a user with a supplied password", async () => {
        const result = await exec({ ...baseArgs, password: "user-password" });

        expect((result.content[0] as { text: string }).text).toBe('User "test-user" created successfully.');
        expect(register).toHaveBeenCalledWith("test-user", "user");
        expect(register).toHaveBeenCalledWith("user-password", "password");
        expect(result.structuredContent).toEqual({
            username: baseArgs.username,
            password: undefined,
        });
    });

    it("generates a password when none is supplied", async () => {
        const result = await exec();

        expect((result.content[0] as { text: string }).text).toContain("with password: `generated-password`");
        expect(register).toHaveBeenCalledWith("generated-password", "password");
        expect(result.structuredContent).toEqual({
            username: baseArgs.username,
            password: "generated-password",
        });
    });

    it.each(["skipped", "failed"] as const)(
        "notes that no access list changes were made when the current IP setup result is %s",
        async (ensureResult) => {
            vi.mocked(ensureCurrentIpInAccessList).mockResolvedValue(ensureResult);

            const result = await exec({ ...baseArgs, password: "user-password" });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain('User "test-user" created successfully');
            expect(text).toContain("No IP access list changes were made");
        }
    );

    it("discloses that the current IP was added to the access list", async () => {
        vi.mocked(ensureCurrentIpInAccessList).mockResolvedValue("added");

        const result = await exec({ ...baseArgs, password: "user-password" });

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("Your current IP address has been added");
    });

    it("does not mention the access list when the current IP is already present", async () => {
        vi.mocked(ensureCurrentIpInAccessList).mockResolvedValue("already-present");

        const result = await exec({ ...baseArgs, password: "user-password" });

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).not.toContain("access list");
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
