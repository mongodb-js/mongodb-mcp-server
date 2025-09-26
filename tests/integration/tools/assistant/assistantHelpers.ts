import { setupIntegrationTest, IntegrationTest, defaultTestConfig } from "../../helpers.js";
import { describe, SuiteCollector } from "vitest";
import { vi, beforeAll, afterAll } from "vitest";

export type IntegrationTestFunction = (integration: IntegrationTest) => void;

export function describeWithAssistant(name: string, fn: IntegrationTestFunction): SuiteCollector<object> {
    const testDefinition = (): void => {
        const integration = setupIntegrationTest(() => ({
            ...defaultTestConfig,
            assistantBaseUrl: "https://knowledge.test.mongodb.com/api/", // Use test URL
        }));

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

    beforeAll(() => {
        global.fetch = mockFetch;
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    const mockListSources: MockedAssistantAPI["mockListSources"] = (sources) => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ dataSources: sources }),
        });
    };

    const mockSearchResults: MockedAssistantAPI["mockSearchResults"] = (results) => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ results }),
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
