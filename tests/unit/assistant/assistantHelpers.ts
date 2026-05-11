import { setupIntegrationTest, defaultTestConfig } from "../../integration/helpers.js";
import type { IntegrationTest } from "../../integration/helpers.js";
import { describe } from "vitest";
import type { SuiteCollector } from "vitest";
import { vi, beforeAll, afterAll, beforeEach } from "vitest";

export type MockIntegrationTestFunction = (integration: IntegrationTest) => void;

export function describeWithAssistant(name: string, fn: MockIntegrationTestFunction): SuiteCollector<object> {
    const testDefinition = (): void => {
        const integration = setupIntegrationTest(() => ({
            ...defaultTestConfig,
            assistantBaseUrl: "https://knowledge-mock.mongodb.com/api/v1", // Not a real URL
        }));

        describe(name, () => {
            fn(integration);
        });
    };

    // eslint-disable-next-line vitest/valid-describe-callback
    return describe("assistant (mocked)", testDefinition);
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
