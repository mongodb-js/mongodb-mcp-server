import { describe, it, expect } from "vitest";
import { getDefaultRoleFromConfig } from "../../../src/common/atlas/roles.js";
import { defaultUserConfig, UserConfig } from "../../../src/common/config.js";

describe("getDefaultRoleFromConfig", () => {
    const defaultConfig: UserConfig = {
        ...defaultUserConfig,
    };

    const readOnlyConfig: UserConfig = {
        ...defaultConfig,
        readOnly: true,
    };

    const readWriteConfig: UserConfig = {
        ...defaultConfig,
        readOnly: false,
        disabledTools: [],
    };

    it("should return the correct role for a read-only config", () => {
        const role = getDefaultRoleFromConfig(readOnlyConfig);
        expect(role).toEqual({
            roleName: "readAnyDatabase",
            databaseName: "admin",
        });
    });

    it("should return the correct role for a read-write config", () => {
        const role = getDefaultRoleFromConfig(readWriteConfig);
        expect(role).toEqual({
            roleName: "readWriteAnyDatabase",
            databaseName: "admin",
        });
    });

    it("should return the correct role for a read-write config with all tools enabled", () => {
        const role = getDefaultRoleFromConfig(readWriteConfig);
        expect(role).toEqual({
            roleName: "readWriteAnyDatabase",
            databaseName: "admin",
        });
    });

    for (const tool of ["create", "update", "delete", "metadata"]) {
        it(`should return the correct role for a config with ${tool} disabled`, () => {
            const config = { ...defaultConfig, disabledTools: [tool] };
            const role = getDefaultRoleFromConfig(config);
            expect(role).toEqual({
                roleName: "readAnyDatabase",
                databaseName: "admin",
            });
        });
    }
});
