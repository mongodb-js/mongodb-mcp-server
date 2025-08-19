import { describe, beforeEach, afterAll, it, expect, TestContext } from "vitest";
import semver from "semver";
import process from "process";
import {
    describeWithMongoDB,
    isCommunityServer,
    getServerVersion,
    MongoDBIntegrationTestCase,
} from "../tools/mongodb/mongodbHelpers.js";
import { defaultTestConfig, responseAsText, timeout, waitUntil } from "../helpers.js";
import { ConnectionStateConnected, ConnectionStateConnecting } from "../../../src/common/connectionManager.js";
import { setupDriverConfig, UserConfig } from "../../../src/common/config.js";
import path from "path";
import type { OIDCMockProviderConfig } from "@mongodb-js/oidc-mock-provider";
import { OIDCMockProvider } from "@mongodb-js/oidc-mock-provider";

const DEFAULT_TIMEOUT = 10000;

// OIDC is only supported on Linux servers
describe.skipIf(process.platform !== "linux")("ConnectionManager OIDC Tests", async () => {
    function setParameter(param: string): ["--setParameter", string] {
        return ["--setParameter", param];
    }

    const defaultOidcConfig = {
        issuer: "mockta",
        clientId: "mocktaTestServer",
        requestScopes: ["mongodbGroups"],
        authorizationClaim: "groups",
        audience: "resource-server-audience-value",
        authNamePrefix: "dev",
    } as const;

    const fetchBrowserFixture = `"${path.resolve(__dirname, "../fixtures/curl.mjs")}"`;

    let tokenFetches: number = 0;
    let getTokenPayload: OIDCMockProviderConfig["getTokenPayload"];
    const oidcMockProviderConfig: OIDCMockProviderConfig = {
        getTokenPayload(metadata) {
            return getTokenPayload(metadata);
        },
    };
    const oidcMockProvider: OIDCMockProvider = await OIDCMockProvider.create(oidcMockProviderConfig);

    afterAll(async () => {
        await oidcMockProvider.close();
    }, DEFAULT_TIMEOUT);

    beforeEach(() => {
        tokenFetches = 0;
        getTokenPayload = ((metadata) => {
            tokenFetches++;
            return {
                expires_in: 1,
                payload: {
                    // Define the user information stored inside the access tokens
                    groups: [`${metadata.client_id}-group`],
                    sub: "testuser",
                    aud: "resource-server-audience-value",
                },
            };
        }) as OIDCMockProviderConfig["getTokenPayload"];
    });

    /**
     * We define a test function for the OIDC tests because we will run the test suite on different MongoDB Versions, to make sure
     * we don't break compatibility with older or newer versions. So this is kind of a test factory for a single server version.
     **/
    type OidcTestParameters = {
        defaultTests: boolean;
        additionalConfig: Partial<UserConfig>;
        additionalServerParams: string[];
    };

    type OidcIt = (
        name: string,
        callback: (context: TestContext, integration: MongoDBIntegrationTestCase) => Promise<void>
    ) => void;
    type OidcTestCases = (it: OidcIt) => void;

    function describeOidcTest(
        mongodbVersion: string,
        context: string,
        args?: Partial<OidcTestParameters>,
        addCb?: OidcTestCases
    ): void {
        const serverOidcConfig = { ...defaultOidcConfig, issuer: oidcMockProvider.issuer };
        const serverArgs = [
            ...setParameter(`oidcIdentityProviders=${JSON.stringify([serverOidcConfig])}`),
            ...setParameter("authenticationMechanisms=SCRAM-SHA-256,MONGODB-OIDC"),
            ...setParameter("enableTestCommands=true"),
            ...(args?.additionalServerParams ?? []),
        ];

        const oidcConfig = {
            ...defaultTestConfig,
            oidcRedirectURi: "http://localhost:0/",
            authenticationMechanism: "MONGODB-OIDC",
            maxIdleTimeMS: "1",
            minPoolSize: "0",
            username: "testuser",
            browser: fetchBrowserFixture,
            ...args?.additionalConfig,
        };

        describeWithMongoDB(
            `${mongodbVersion} Enterprise  :: ${context}`,
            (integration) => {
                function oidcIt(name: string, cb: Parameters<OidcIt>[1]): void {
                    /* eslint-disable vitest/expect-expect */
                    it(name, { timeout: DEFAULT_TIMEOUT }, async (context) => {
                        context.skip(
                            await isCommunityServer(integration),
                            "OIDC is not supported in MongoDB Community"
                        );
                        context.skip(
                            semver.satisfies(await getServerVersion(integration), "< 7", { includePrerelease: true }),
                            "OIDC is only supported on MongoDB newer than 7.0"
                        );

                        await cb?.(context, integration);
                    });
                    /* eslint-enable vitest/expect-expect */
                }

                beforeEach(async () => {
                    const connectionManager = integration.mcpServer().session.connectionManager;
                    // disconnect on purpose doesn't change the state if it was failed to avoid losing
                    // information in production.
                    await connectionManager.disconnect();
                    // for testing, force disconnecting AND setting the connection to closed to reset the
                    // state of the connection manager
                    connectionManager.changeState("connection-closed", { tag: "disconnected" });

                    await integration.connectMcpClient();
                }, DEFAULT_TIMEOUT);

                addCb?.(oidcIt);
            },
            () => oidcConfig,
            () => ({
                ...setupDriverConfig({
                    config: oidcConfig,
                    defaults: {},
                }),
            }),
            { enterprise: true, version: mongodbVersion },
            serverArgs
        );
    }

    const baseTestMatrix = [
        { version: "8.0.12", nonce: false },
        { version: "8.0.12", nonce: true },
    ] as const;

    for (const { version, nonce } of baseTestMatrix) {
        describeOidcTest(version, `auth-flow;nonce=${nonce}`, { additionalConfig: { oidcNoNonce: !nonce } }, (it) => {
            it("can connect with the expected user", async ({ signal }, integration) => {
                const state = await waitUntil<ConnectionStateConnected>(
                    "connected",
                    integration.mcpServer().session.connectionManager,
                    signal
                );

                type ConnectionStatus = {
                    authInfo: {
                        authenticatedUsers: { user: string; db: string }[];
                        authenticatedUserRoles: { role: string; db: string }[];
                    };
                };

                const status: ConnectionStatus = (await state.serviceProvider.runCommand("admin", {
                    connectionStatus: 1,
                })) as unknown as ConnectionStatus;

                expect(status.authInfo.authenticatedUsers[0]).toEqual({ user: "dev/testuser", db: "$external" });
                expect(status.authInfo.authenticatedUserRoles[0]).toEqual({
                    role: "dev/mocktaTestServer-group",
                    db: "admin",
                });
            });

            it("can list existing databases", async ({ signal }, integration) => {
                const state = await waitUntil<ConnectionStateConnected>(
                    "connected",
                    integration.mcpServer().session.connectionManager,
                    signal
                );

                const listDbResult = await state.serviceProvider.listDatabases("admin");
                const databases = listDbResult.databases as unknown[];
                expect(databases.length).toBeGreaterThan(0);
            });

            it("can refresh a token once expired", async ({ signal }, integration) => {
                const state = await waitUntil<ConnectionStateConnected>(
                    "connected",
                    integration.mcpServer().session.connectionManager,
                    signal
                );

                await timeout(2000);
                await state.serviceProvider.listDatabases("admin");
                expect(tokenFetches).toBeGreaterThan(1);
            });
        });
    }

    // just infer from all the versions in the base test matrix, so it doesn't need to be maintained separately
    const deviceAuthMatrix = new Set(baseTestMatrix.map((base) => base.version));

    for (const version of deviceAuthMatrix) {
        describeOidcTest(
            version,
            "device-flow",
            { additionalConfig: { oidcFlows: "device-auth", browser: false } },
            (it) => {
                it("gets requested by the agent to connect", async ({ signal }, integration) => {
                    const state = await waitUntil<ConnectionStateConnecting>(
                        "connecting",
                        integration.mcpServer().session.connectionManager,
                        signal,
                        (state) => !!state.oidcLoginUrl && !!state.oidcUserCode
                    );

                    const response = responseAsText(
                        await integration.mcpClient().callTool({ name: "list-databases", arguments: {} })
                    );

                    expect(response).toContain("The user needs to finish their OIDC connection by opening");
                    expect(response).toContain(state.oidcLoginUrl);
                    expect(response).toContain(state.oidcUserCode);
                    expect(response).not.toContain("Please use one of the following tools");
                    expect(response).not.toContain("There are no tools available to connect.");

                    await waitUntil<ConnectionStateConnected>(
                        "connected",
                        integration.mcpServer().session.connectionManager,
                        signal
                    );

                    const connectedResponse = responseAsText(
                        await integration.mcpClient().callTool({ name: "list-databases", arguments: {} })
                    );

                    expect(connectedResponse).toContain("admin");
                    expect(connectedResponse).toContain("config");
                    expect(connectedResponse).toContain("local");
                });
            }
        );
    }
});
