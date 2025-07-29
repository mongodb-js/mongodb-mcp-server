import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccessToken } from "../../../src/common/atlas/apiClient.js";
import { ApiClient } from "../../../src/common/atlas/apiClient.js";
import { HTTPServerProxyTestSetup } from "../fixtures/httpsServerProxyTest.js";

describe("ApiClient integration test", () => {
    describe("oauth authentication proxy", () => {
        let apiClient: ApiClient;
        let proxyTestSetup: HTTPServerProxyTestSetup;

        beforeEach(async () => {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
            proxyTestSetup = new HTTPServerProxyTestSetup();
            await proxyTestSetup.listen();

            process.env.HTTP_PROXY = `https://localhost:${proxyTestSetup.httpsProxyPort}/`;
            apiClient = new ApiClient({
                baseUrl: `https://localhost:${proxyTestSetup.httpsServerPort}/`,
                credentials: {
                    clientId: "test-client-id",
                    clientSecret: "test-client-secret",
                },
                userAgent: "test-user-agent",
            });
        });

        function withToken(accessToken: string, expired: boolean) {
            const apiClientMut = apiClient as unknown as { accessToken: AccessToken };
            const expireAt = expired ? Date.now() - 100000 : Date.now() + 10000;

            apiClientMut.accessToken = {
                access_token: accessToken,
                expires_at: expireAt,
            };
        }

        afterEach(async () => {
            delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
            delete process.env.HTTP_PROXY;

            await apiClient.close();
            await proxyTestSetup.teardown();
        });

        it("should send the oauth request through a proxy if configured", async () => {
            await apiClient.validateAccessToken();
            expect(proxyTestSetup.getRequestedUrls()).toEqual([
                `http://localhost:${proxyTestSetup.httpsServerPort}/api/oauth/token`,
            ]);
        });

        it("should send the oauth revoke request through a proxy if configured", async () => {
            withToken("my non expired token", false);
            await apiClient.close();
            expect(proxyTestSetup.getRequestedUrls()).toEqual([
                `http://localhost:${proxyTestSetup.httpsServerPort}/api/oauth/revoke`,
            ]);
        });

        it("should make an atlas call when the token is not expired", async () => {
            withToken("my not expired", false);
            await apiClient.listOrganizations();
            expect(proxyTestSetup.getRequestedUrls()).toEqual([
                `http://localhost:${proxyTestSetup.httpsServerPort}/api/atlas/v2/orgs`,
            ]);
        });

        it("should request a new token and an atlas call when the token is expired", async () => {
            withToken("my expired", true);
            await apiClient.listOrganizations();
            expect(proxyTestSetup.getRequestedUrls()).toEqual([
                `http://localhost:${proxyTestSetup.httpsServerPort}/api/oauth/token`,
                `http://localhost:${proxyTestSetup.httpsServerPort}/api/atlas/v2/orgs`,
            ]);
        });
    });
});
