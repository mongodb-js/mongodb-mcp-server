import { ApiClient } from "./dist/common/atlas/apiClient.js";

        let apiClient;
        let proxyServer;
        let requests;
            process.env.HTTP_PROXY = "localhost:8888";
            apiClient = new ApiClient({
                baseUrl: "https://httpbin.org",
                credentials: {
                    clientId: "test-client-id",
                    clientSecret: "test-client-secret",
                },
                userAgent: "test-user-agent",
            });

            requests = [];
            await apiClient.validateAccessToken();
            console.log(requests);
            expect(true).toBeFalsy();
            delete process.env.HTTP_PROXY;

            proxyServer.close();
            //await apiClient.close();
