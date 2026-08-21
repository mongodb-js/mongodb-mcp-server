import { expect } from "vitest";
import { toIncludeSameMembers } from "@mongodb-js/mcp-test-utils";

// Extend vitest's expect with custom matchers
expect.extend({
    toIncludeSameMembers,
});
