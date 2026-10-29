import { describe, it, expectTypeOf } from "vitest";
import type { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { SessionTransport } from "./sessionTransport.js";

describe("SessionTransport", () => {
    // Compile-time only: a type alias has no runtime behaviour to assert.
    // eslint-disable-next-line vitest/expect-expect
    it("is the transport the legacy HTTP path serves sessions through", () => {
        expectTypeOf<SessionTransport>().toEqualTypeOf<NodeStreamableHTTPServerTransport>();
    });
});
