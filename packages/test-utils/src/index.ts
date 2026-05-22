export {
    createMockElicitInput,
    createMockGetClientCapabilities,
    type MockClientCapabilities,
    type MockElicitResult,
} from "./elicitationMocks.js";
export { MockMetrics } from "./mockMetrics.js";

export { createEnvironment, useClearEnvironment } from "./testUtils.js";

export {
    MongoDBClusterProcess,
    type MongoClusterConfiguration,
    type MongoRunnerConfiguration,
    type MongoSearchConfiguration,
    type MongoAutoEmbedSearchConfiguration,
} from "./mongodbClusterProcess.js";

export { toIncludeSameMembers } from "./matchers/toIncludeSameMembers.js";

/** Expects the argument being defined and asserts it */
export function expectDefined<T>(arg: T): asserts arg is Exclude<T, undefined | null> {
    if (arg === undefined || arg === null) {
        throw new Error(`Expected value to be defined, but got ${String(arg)}`);
    }
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @alias sleep */
export const timeout = sleep;
