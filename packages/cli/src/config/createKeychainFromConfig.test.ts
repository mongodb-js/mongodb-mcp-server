import { describe, it, expect } from "vitest";
import { createKeychainFromConfig } from "./createKeychainFromConfig.js";
import { UserConfigSchema } from "./userConfig.js";

describe("createKeychainFromConfig", () => {
    it("registers config-derived secrets", () => {
        const config = UserConfigSchema.parse({ apiClientSecret: "config-secret" });
        const keychain = createKeychainFromConfig({ config });
        expect(keychain.redact("using config-secret here")).not.toContain("config-secret");
    });

    it("registers and redacts secrets passed via additionalSecrets", () => {
        const config = UserConfigSchema.parse({});
        const keychain = createKeychainFromConfig({
            config,
            additionalSecrets: { "extra-secret": "password" },
        });
        expect(keychain.redact("token extra-secret here")).not.toContain("extra-secret");
    });

    it("lets config-derived values win on a key collision", () => {
        const config = UserConfigSchema.parse({ apiClientSecret: "collide-value" });
        const keychain = createKeychainFromConfig({
            config,
            additionalSecrets: { "collide-value": "user" },
        });
        // The config-derived kind (password) wins over additionalSecrets (user).
        expect(keychain.redact("collide-value")).toBe("<password>");
    });

    it("can be built with no secrets at all", () => {
        const keychain = createKeychainFromConfig({ config: UserConfigSchema.parse({}) });
        expect(keychain.redact("nothing")).toBe("nothing");
    });
});
