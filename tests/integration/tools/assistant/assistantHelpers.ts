import { setupIntegrationTest, IntegrationTest, defaultTestConfig, defaultDriverOptions } from "../../helpers.js";
import { describe, SuiteCollector } from "vitest";
import { vi, beforeAll, afterAll, beforeEach } from "vitest";

export type IntegrationTestFunction = (integration: IntegrationTest) => void;

export function describeWithAssistant(name: string, fn: IntegrationTestFunction): SuiteCollector<object> {
    const testDefinition = (): void => {
        const integration = setupIntegrationTest(
            () => ({
                ...defaultTestConfig,
                assistantBaseUrl: "https://knowledge.test.mongodb.com/api/", // Not a real URL
            }),
            () => ({
                ...defaultDriverOptions,
            })
        );

        describe(name, () => {
            fn(integration);
        });
    };

    // eslint-disable-next-line vitest/valid-describe-callback
    return describe("assistant", testDefinition);
}

/**
 * Mocks fetch for assistant API calls
 */
interface MockedAssistantAPI {
    mockListSources: (sources: unknown[]) => void;
    mockSearchResults: (results: unknown[]) => void;
    mockAPIError: (status: number, statusText: string) => void;
    mockNetworkError: (error: Error) => void;
    mockFetch: ReturnType<typeof vi.fn>;
}

export function makeMockAssistantAPI(): MockedAssistantAPI {
    const mockFetch = vi.fn();

    beforeAll(async () => {
        const { createFetch } = await import("@mongodb-js/devtools-proxy-support");
        vi.mocked(createFetch).mockReturnValue(mockFetch as never);
    });

    beforeEach(() => {
        mockFetch.mockClear();
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    const mockListSources: MockedAssistantAPI["mockListSources"] = (sources) => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ dataSources: sources }),
        });
    };

    const mockSearchResults: MockedAssistantAPI["mockSearchResults"] = (results) => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ results }),
        });
    };

    const mockAPIError: MockedAssistantAPI["mockAPIError"] = (status, statusText) => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status,
            statusText,
        });
    };

    const mockNetworkError: MockedAssistantAPI["mockNetworkError"] = (error) => {
        mockFetch.mockRejectedValueOnce(error);
    };

    return {
        mockListSources,
        mockSearchResults,
        mockAPIError,
        mockNetworkError,
        mockFetch,
    };
}
