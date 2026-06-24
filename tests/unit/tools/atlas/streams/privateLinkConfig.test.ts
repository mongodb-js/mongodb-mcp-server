import { describe, it, expect } from "vitest";
import { PrivateLinkConnectionConfig } from "../../../../../src/tools/atlas/streams/privateLinkConfig.js";
import { getConnectionConfigSchema } from "../../../../../src/tools/atlas/streams/connectionConfigs.js";

describe("PrivateLinkConnectionConfig", () => {
    it("accepts AWS PrivateLink with required fields", () => {
        const result = PrivateLinkConnectionConfig.safeParse({
            provider: "AWS",
            region: "us-east-1",
            vendor: "CONFLUENT",
            serviceEndpointId: "com.amazonaws.vpce.us-east-1.vpce-svc-xyz",
            dnsDomain: "example.confluent.cloud",
            dnsSubDomain: [],
        });
        expect(result.success).toBe(true);
    });

    it("rejects PrivateLink config without provider", () => {
        const result = PrivateLinkConnectionConfig.safeParse({ region: "us-east-1" });
        expect(result.success).toBe(false);
    });

    it("rejects PrivateLink config with invalid provider value", () => {
        const result = PrivateLinkConnectionConfig.safeParse({ provider: "ORACLE" });
        expect(result.success).toBe(false);
    });

    it("is registered in the connection config dispatch for 'PrivateLink'", () => {
        expect(getConnectionConfigSchema("PrivateLink")).toBe(PrivateLinkConnectionConfig);
    });
});
