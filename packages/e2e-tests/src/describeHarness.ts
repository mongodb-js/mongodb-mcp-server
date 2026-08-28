import { describe } from "vitest";
import { AGENT_HARNESSES, type AgentHarness } from "@mongodb-js/harness-tester";

export interface DescribeHarnessContext {
    /** The single harness instance the inner describe runs against. */
    harness: AgentHarness;
}

/**
 * Register a `describe("with <harness.name>")` block per registered harness.
 * Call it inside the suite's own describe:
 *
 *   describe("server setup", () => {
 *     describeHarness(({ harness }) => {
 *       const { buildOptions } = useMcpAgent({ harness });
 *       it("...", async () => { ... });
 *     });
 *   });
 */
export function describeHarness(fn: (ctx: DescribeHarnessContext) => void): void {
    for (const Harness of AGENT_HARNESSES) {
        const harness = new Harness();
        describe(`with ${harness.name}`, () => {
            fn({ harness });
        });
    }
}
