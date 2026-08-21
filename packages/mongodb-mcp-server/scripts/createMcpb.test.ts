import { describe, it, expect } from "vitest";
import { buildStagingPackageJson, ATLAS_LOCAL_PLATFORM_PACKAGES } from "./createMcpb.js";
import type { PackageJson } from "./createMcpb.js";

describe("buildStagingPackageJson", () => {
    const rootPkg: PackageJson = {
        name: "mongodb-mcp-server",
        version: "1.2.3",
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
        const deps = staged.dependencies as Record<string, string>;
        expect(deps.mongodb).toBe("^7.1.1");
        expect(deps.express).toBe("^5.2.1");
    });

    it("force-adds every atlas-local platform package as a direct dependency", () => {
        const staged = buildStagingPackageJson(rootPkg);
        const deps = staged.dependencies as Record<string, string>;
        for (const pkg of ATLAS_LOCAL_PLATFORM_PACKAGES) {
            expect(deps[pkg]).toBe("1.3.0");
        }
    });

    it("matches the @mongodb-js/atlas-local version when adding platform pkgs", () => {
        const custom = {
            ...rootPkg,
            dependencies: { ...(rootPkg.dependencies as Record<string, string>), "@mongodb-js/atlas-local": "^2.0.0" },
        };
        const staged = buildStagingPackageJson(custom as unknown as PackageJson);
        const deps = staged.dependencies as Record<string, string>;
        for (const pkg of ATLAS_LOCAL_PLATFORM_PACKAGES) {
            expect(deps[pkg]).toBe("2.0.0");
        }
    });

    it("sets name and private:true on the staging package", () => {
        const staged = buildStagingPackageJson(rootPkg);
        expect(staged.name).toBe("mongodb-mcp-server-mcpb-staging");
        expect((staged as { private?: boolean }).private).toBe(true);
    });
});
