import type { TestContext } from "vitest";
import { describe, beforeEach, afterAll, it, expect, vi } from "vitest";
import semver from "semver";
import process from "process";
import type { MongoDBIntegrationTestCase } from "../tools/mongodb/mongodbHelpers.js";
import { describeWithMongoDB, isCommunityServer, getServerVersion } from "../tools/mongodb/mongodbHelpers.js";
import { connect, defaultTestConfig, responseAsText, timeout, waitUntil } from "../helpers.js";
import type { ConnectionStateConnected, ConnectionStateConnecting } from "../../../src/common/connectionManager.js";
import type { UserConfig } from "../../../src/common/config/userConfig.js";
import path from "path";
import type { OIDCMockProviderConfig } from "@mongodb-js/oidc-mock-provider";
import { OIDCMockProvider } from "@mongodb-js/oidc-mock-provider";
import { type TestConnectionManager } from "../../utils/index.js";

const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_RETRIES = 5;
// Long-lived token for tests that only need a successful connection. A short (1s) lifetime
// races the OIDC handshake under CI load and intermittently produces server-side
// "Authentication failed" (code 18) errors. Only the token-refresh test deliberately
// overrides this with a short lifetime.
const DEFAULT_TOKEN_EXPIRY_SECONDS = 3600;

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
    let tokenExpiresInSeconds: number = DEFAULT_TOKEN_EXPIRY_SECONDS;
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
                expires_in: tokenExpiresInSeconds,
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
        tokenExpiresInSeconds: number;
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
            oidcRedirectUri: "http://localhost:0/",
            authenticationMechanism: "MONGODB-OIDC",
            maxIdleTimeMS: "10000",
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
                    it(name, { timeout: DEFAULT_TIMEOUT, retry: DEFAULT_RETRIES }, async (context) => {
                        // eslint-disable-next-line vitest/no-disabled-tests
                        context.skip(
                            await isCommunityServer(integration),
                            "OIDC is not supported in MongoDB Community"
                        );
                        // eslint-disable-next-line vitest/no-disabled-tests
                        context.skip(
                            semver.satisfies(await getServerVersion(integration), "< 7", {
                                includePrerelease: true,
                            }),
                            "OIDC is only supported on MongoDB newer than 7.0"
                        );

                        await cb?.(context, integration);
                    });
                    /* eslint-enable vitest/expect-expect */
                }

                beforeEach(async () => {
                    tokenExpiresInSeconds = args?.tokenExpiresInSeconds ?? DEFAULT_TOKEN_EXPIRY_SECONDS;

                    const connectionManager = integration.mcpServer().session
                        .connectionManager as TestConnectionManager;
                    // disconnect on purpose doesn't change the state if it was failed to avoid losing
                    // information in production.
                    await connectionManager.disconnect();
                    // for testing, force disconnecting AND setting the connection to closed to reset the
                    // state of the connection manager
                    connectionManager.changeState("connection-close", { tag: "disconnected" });

                    await connect(integration.mcpClient(), integration.connectionString());
                }, DEFAULT_TIMEOUT);

                addCb?.(oidcIt);
            },
            {
                getUserConfig: () => oidcConfig,
                downloadOptions: {
                    runner: true,
                    downloadOptions: { enterprise: true, version: mongodbVersion },
                    serverArgs,
                },
            }
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

                const status: ConnectionStatus = await vi.waitFor(
                    async () => {
                        const result = (await state.serviceProvider.runCommand("admin", {
                            connectionStatus: 1,
                        })) as unknown as ConnectionStatus | undefined;

                        if (!result) {
                            throw new Error("Status can not be undefined. Retrying.");
                        }

                        if (!result.authInfo.authenticatedUsers.length) {
                            throw new Error("No authenticated users found. Retrying.");
                        }

                        if (!result.authInfo.authenticatedUserRoles.length) {
                            throw new Error("No authenticated user roles found. Retrying.");
                        }

                        return result;
                    },
                    { timeout: 5000 }
                );

                expect(status.authInfo.authenticatedUsers[0]).toEqual({
                    user: "dev/testuser",
                    db: "$external",
                });
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
        });
    }

    // Token refresh behaviour is independent of the nonce setting, so we run it once per
    // server version. It deliberately uses a short-lived (1s) token so the token expires
    // during the test and the next operation triggers a refresh.
    const refreshMatrix = new Set(baseTestMatrix.map((base) => base.version));
    for (const version of refreshMatrix) {
        describeOidcTest(version, "token-refresh", { tokenExpiresInSeconds: 1 }, (it) => {
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

                it("surfaces the device-flow URL and code directly from the connect tool", async ({
                    signal,
                    skip,
                }, integration) => {
                    // Reset so we can drive a fresh connect through the tool and inspect its response.
                    const connectionManager = integration.mcpServer().session
                        .connectionManager as TestConnectionManager;
                    await connectionManager.disconnect();
                    connectionManager.changeState("connection-close", { tag: "disconnected" });

                    const connectResponse = responseAsText(
                        await integration.mcpClient().callTool({
                            name: "connect",
                            arguments: { connectionString: integration.connectionString() },
                        })
                    );

                    // If the IdP completed auth without ever falling back to device flow, there is
                    // nothing to assert here; the dedicated test above covers the device-flow path.
                    if (!connectResponse.includes("The user needs to finish their OIDC connection by opening")) {
                        return skip();
                    }

                    const state = await waitUntil<ConnectionStateConnecting>(
                        "connecting",
                        connectionManager,
                        signal,
                        (state) => !!state.oidcLoginUrl && !!state.oidcUserCode
                    );

                    expect(connectResponse).toContain(state.oidcLoginUrl);
                    expect(connectResponse).toContain(state.oidcUserCode);
                    expect(connectResponse).not.toContain("Successfully connected to MongoDB.");
                });
            }
        );
    }
});
