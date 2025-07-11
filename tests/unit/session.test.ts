import { jest } from "@jest/globals";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { Session } from "../../src/common/session.js";
import { config } from "../../src/common/config.js";

jest.mock("@mongosh/service-provider-node-driver");
const MockNodeDriverServiceProvider = NodeDriverServiceProvider as jest.MockedClass<typeof NodeDriverServiceProvider>;

describe("Session", () => {
    let session: Session;
    beforeEach(() => {
        session = new Session({
            apiClientId: "test-client-id",
            apiBaseUrl: "https://api.test.com",
        });

        MockNodeDriverServiceProvider.connect = jest.fn(() =>
            Promise.resolve({} as unknown as NodeDriverServiceProvider)
        );
    });

    describe("connectToMongoDB", () => {
        const testCases: {
            connectionString: string;
            expectAppName: boolean;
            name: string;
        }[] = [
            {
                connectionString: "mongodb://localhost:27017",
                expectAppName: true,
                name: "db without appName",
            },
            {
                connectionString: "mongodb://localhost:27017?appName=CustomAppName",
                expectAppName: false,
                name: "db with custom appName",
            },
            {
                connectionString:
                    "mongodb+srv://test.mongodb.net/test?retryWrites=true&w=majority&appName=CustomAppName",
                expectAppName: false,
                name: "atlas db with custom appName",
            },
        ];

        for (const testCase of testCases) {
            it(`should update connection string for ${testCase.name}`, async () => {
                await session.connectToMongoDB(testCase.connectionString, config.connectOptions);
                expect(session.serviceProvider).toBeDefined();

                // eslint-disable-next-line @typescript-eslint/unbound-method
                const connectMock = MockNodeDriverServiceProvider.connect as jest.Mock<
                    typeof NodeDriverServiceProvider.connect
                >;
                expect(connectMock).toHaveBeenCalledOnce();
                const connectionString = connectMock.mock.calls[0]?.[0];
                if (testCase.expectAppName) {
                    expect(connectionString).toContain("appName=MongoDB+MCP+Server");
                } else {
                    expect(connectionString).not.toContain("appName=MongoDB+MCP+Server");
                }
            });
        }
    });
});
