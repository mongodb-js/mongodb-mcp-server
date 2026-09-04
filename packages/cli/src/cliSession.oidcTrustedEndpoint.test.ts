import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import { parseUserConfig } from "./config/parseUserConfig.js";

vi.mock("@mongosh/arg-parser", async (importOriginal) => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    const actual = await importOriginal<typeof import("@mongosh/arg-parser")>();
    return {
        ...actual,
        generateConnectionInfoFromCliArgs: vi.fn(actual.generateConnectionInfoFromCliArgs),
    };
});

const mockGenerateFn = vi.mocked(generateConnectionInfoFromCliArgs);

describe("oidcTrustedEndpoint — CLI option propagation", () => {
    // parseUserConfig additionally merges MDB_MCP_-prefixed environment
    // variables; clear them so the CLI-args-only assertions below are
    // deterministic regardless of the host environment.
    let savedEnv: Record<string, string | undefined>;

    beforeEach(() => {
        mockGenerateFn.mockClear();
        savedEnv = Object.create(null) as Record<string, string | undefined>;
        for (const key of Object.keys(process.env)) {
            if (key.startsWith("MDB_MCP_")) {
                savedEnv[key] = process.env[key];
                delete process.env[key];
            }
        }
    });

    afterEach(() => {
        Object.assign(process.env, savedEnv);
    });

    it("passes oidcTrustedEndpoint from the CLI args into connection info generation", () => {
        const { parsed, error } = parseUserConfig({
            args: ["mongodb://localhost:27017/", "--oidcTrustedEndpoint"],
        });

        expect(error).toBeUndefined();
        expect(parsed).toBeDefined();
        expect(mockGenerateFn).toHaveBeenCalledWith(
            expect.objectContaining({
                oidcTrustedEndpoint: true,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                connectionSpecifier: expect.stringContaining("mongodb://localhost:27017/"),
            })
        );
    });

    it("does NOT pass oidcTrustedEndpoint when it is not configured", () => {
        parseUserConfig({
            args: ["mongodb://localhost:27017/"],
        });

        expect(mockGenerateFn).toHaveBeenCalledWith(expect.not.objectContaining({ oidcTrustedEndpoint: true }));
    });
});
