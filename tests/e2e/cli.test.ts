import { describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import "./e2eUtils.js";
import { useCliRunner } from "./e2eUtils.js";

describe("CLI entrypoint", () => {
    const { runServer } = useCliRunner();

    it("should handle version request", async () => {
        const { stdout, stderr } = await runServer({ args: ["--version"], dryRun: false });
        expect(stdout).toContain(packageJson.version);
        expect(stderr).toEqual("");
    });

    it("should handle help request", async () => {
        const { stdout, stderr } = await runServer({ args: ["--help"], dryRun: false });
        expect(stdout).toContain("For usage information refer to the README.md");
        expect(stderr).toEqual("");
    });

    it("should handle dry run request", async () => {
        const { stdout } = await runServer({ args: ["--dryRun"] });
        expect(stdout).toContain("Configuration:");
        expect(stdout).toContain("Enabled tools:");
        // We don't do stderr assertions because in our CI, for docker-less env
        // atlas local tools push message on stderr stream.
    });

    it("should handle complex configuration", async () => {
        const { stdout } = await runServer({
            args: [
                "--connectionString",
                "mongodb://localhost:1000",
                "--readOnly",
                "--httpPort",
                "8080",
                "--httpHeaders",
                '{"test": "3"}',
            ],
            stripWhitespace: true,
        });
        expect(stdout).toContain('"connectionString":"mongodb://localhost:1000"');
        expect(stdout).toContain('"httpPort":8080');
        expect(stdout).toContain('"httpHeaders":{"test":"3"}');
        expect(stdout).toContain('"readOnly":true');
    });

    describe("warnings and error messages", () => {
        const referDocMessage =
            "- Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server.";

        describe("Deprecated CLI arguments", () => {
            const testCases: { readonly cliArg: string; readonly value?: string; readonly warning: string }[] = [
                {
                    cliArg: "--connectionString",
                    value: "mongodb://localhost:27017",
                    warning:
                        "Warning: The --connectionString argument is deprecated. Prefer using the MDB_MCP_CONNECTION_STRING environment variable or the first positional argument for the connection string.",
                },
            ] as const;

            for (const { cliArg, value, warning } of testCases) {
                describe(`deprecation behaviour of ${cliArg}`, () => {
                    it(`warns the usage of ${cliArg} as it is deprecated`, async () => {
                        const { stderr } = await runServer({ args: [cliArg, ...(value ? [value] : [])] });
                        expect(stderr).toContain(warning);
                    });

                    it(`shows the reference message when ${cliArg} was passed`, async () => {
                        const { stderr } = await runServer({ args: [cliArg, ...(value ? [value] : [])] });
                        expect(stderr).toContain(referDocMessage);
                    });
                });
            }
        });

        describe("invalid arguments", () => {
            const invalidArgumentTestCases = [
                {
                    description: "should show an error when an argument is not known",
                    args: ["--wakanda", "forever"],
                    expectedError: "Error: Invalid command line argument '--wakanda'.",
                },
                {
                    description: "should show an error when nodb is used",
                    args: ["--nodb"],
                    expectedError:
                        "Error: The --nodb argument is not supported in the MCP Server. Please remove it from your configuration.",
                },
                {
                    description: "should show a suggestion when is a simple typo",
                    args: ["--readonli", ""],
                    expectedError: "Error: Invalid command line argument '--readonli'. Did you mean '--readOnly'?",
                },
                {
                    description: "should show a suggestion when the only change is on the case",
                    args: ["--readonly", ""],
                    expectedError: "Error: Invalid command line argument '--readonly'. Did you mean '--readOnly'?",
                },
            ];

            for (const { description, args, expectedError } of invalidArgumentTestCases) {
                it(description, async () => {
                    try {
                        await runServer({ args });
                        expect.fail("Expected process to exit with error");
                    } catch (error: unknown) {
                        const execError = error as { stderr?: string; code?: number };
                        expect(execError.code).toBe(1);
                        expect(execError.stderr).toContain(expectedError);
                        expect(execError.stderr).toContain(referDocMessage);
                    }
                });
            }
        });

        describe("vector search misconfiguration", () => {
            it("should warn if vectorSearch is enabled but embeddings provider is not configured", async () => {
                const { stderr } = await runServer({ args: ["--previewFeatures", "search"] });
                expect(stderr).toContain("Vector search is enabled but no embeddings provider is configured");
            });

            it("should warn if vectorSearch is not enabled but embeddings provider is configured", async () => {
                const { stderr } = await runServer({ args: ["--voyageApiKey", "1FOO"] });

                expect(stderr).toContain(
                    "An embeddings provider is configured but the 'search' preview feature is not enabled"
                );
            });

            it("should not warn if vectorSearch is enabled correctly", async () => {
                const { stderr } = await runServer({
                    args: ["--voyageApiKey", "1FOO", "--previewFeatures", "search", "--dryRun"],
                });
                expect(stderr).not.toContain("Vector search is enabled but no embeddings provider is configured");
                expect(stderr).not.toContain(
                    "An embeddings provider is configured but the 'search' preview feature is not enabled"
                );
            });
        });
    });
});
