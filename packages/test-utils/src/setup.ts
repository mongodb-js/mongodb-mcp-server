import { expect } from "vitest";
import { toIncludeSameMembers } from "./matchers/toIncludeSameMembers.js";

// Extend vitest's expect with custom matchers
expect.extend({
    toIncludeSameMembers,
});
