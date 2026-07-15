import { describe, it, expect } from "vitest";
import { buildStagingPackageJson, ATLAS_LOCAL_PLATFORM_PACKAGES } from "./createMcpb.js";

describe("buildStagingPackageJson", () => {
    const rootPkg = {
        name: "mongodb-mcp-server",
        version: "1.2.3",
        description: "x",
        dependencies: {
            mongodb: "^7.1.1",
            express: "^5.2.1",
            "@mongodb-js/atlas-local": "^1.3.0",
        },
        optionalDependencies: {
            kerberos: "^7.0.0",
            "@mongodb-js/atlas-local": "^1.3.0",
        },
    };

    it("keeps mongodb and express", () => {
        const staged = buildStagingPackageJson(rootPkg);
        expect(staged.dependencies?.mongodb).toBe("^7.1.1");
        expect(staged.dependencies?.express).toBe("^5.2.1");
    });

    it("force-adds every atlas-local platform package as a direct dependency", () => {
        const staged = buildStagingPackageJson(rootPkg);
        for (const pkg of ATLAS_LOCAL_PLATFORM_PACKAGES) {
            expect(staged.dependencies?.[pkg]).toBe("1.3.0");
        }
    });

    it("matches the @mongodb-js/atlas-local version when adding platform pkgs", () => {
        const custom = { ...rootPkg, dependencies: { ...rootPkg.dependencies, "@mongodb-js/atlas-local": "^2.0.0" } };
        const staged = buildStagingPackageJson(custom);
        for (const pkg of ATLAS_LOCAL_PLATFORM_PACKAGES) {
            expect(staged.dependencies?.[pkg]).toBe("2.0.0");
        }
    });

    it("sets name and private:true on the staging package", () => {
        const staged = buildStagingPackageJson(rootPkg);
        expect(staged.name).toBe("mongodb-mcp-server-mcpb-staging");
        expect(staged.private).toBe(true);
    });
});
