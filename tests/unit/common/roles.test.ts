import { describe, it, expect } from "vitest";
import { getDefaultRoleFromConfig } from "../../../src/common/atlas/roles.js";
import { defaultUserConfig, type UserConfig } from "../../../src/common/config.js";

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

    const readWriteConfigWithDeleteDisabled: UserConfig = {
        ...defaultConfig,
        readOnly: false,
        disabledTools: ["delete"],
    };

    const readWriteConfigWithCreateDisabled: UserConfig = {
        ...defaultConfig,
        readOnly: false,
        disabledTools: ["create"],
    };

    const readWriteConfigWithUpdateDisabled: UserConfig = {
        ...defaultConfig,
        readOnly: false,
        disabledTools: ["update"],
    };

    const readWriteConfigWithAllToolsDisabled: UserConfig = {
        ...defaultConfig,
        readOnly: false,
        disabledTools: ["create", "update", "delete"],
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

    it("should return the correct role for a read-write config with delete disabled", () => {
        const role = getDefaultRoleFromConfig(readWriteConfigWithDeleteDisabled);
        expect(role).toEqual({
            roleName: "readWriteAnyDatabase",
            databaseName: "admin",
        });
    });

    it("should return the correct role for a read-write config with create disabled", () => {
        const role = getDefaultRoleFromConfig(readWriteConfigWithCreateDisabled);
        expect(role).toEqual({
            roleName: "readWriteAnyDatabase",
            databaseName: "admin",
        });
    });

    it("should return the correct role for a read-write config with update disabled", () => {
        const role = getDefaultRoleFromConfig(readWriteConfigWithUpdateDisabled);
        expect(role).toEqual({
            roleName: "readWriteAnyDatabase",
            databaseName: "admin",
        });
    });

    it("should return the correct role for a read-write config with all tools disabled", () => {
        const role = getDefaultRoleFromConfig(readWriteConfigWithAllToolsDisabled);
        expect(role).toEqual({
            roleName: "readAnyDatabase",
            databaseName: "admin",
        });
    });
});
