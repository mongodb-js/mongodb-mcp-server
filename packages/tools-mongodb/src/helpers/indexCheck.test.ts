import { describe, expect, it, vi } from "vitest";
import { usesIndex, getIndexCheckErrorMessage, checkIndexUsage, ErrorCodes } from "@mongodb-js/mcp-tools-mongodb";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import type { Document } from "mongodb";

describe("indexCheck", () => {
    describe("usesIndex", () => {
        describe("sharded winning plans", () => {
            const indexedPlan = { stage: "FETCH", inputStage: { stage: "IXSCAN" } };

            it.each(["SINGLE_SHARD", "SHARD_MERGE", "SHARD_MERGE_SORT"])(
                "should inspect every shard under %s",
                (stage) => {
                    expect(
                        usesIndex({
                            queryPlanner: {
                                winningPlan: {
                                    stage,
                                    shards: [{ winningPlan: indexedPlan }, { winningPlan: indexedPlan }],
                                },
                            },
                        })
                    ).toBe(true);
                }
            );

            it("should recognize an indexed single-shard plan beneath LIMIT and FETCH", () => {
                expect(
                    usesIndex({
                        queryPlanner: {
                            winningPlan: {
                                stage: "SINGLE_SHARD",
                                shards: [{ winningPlan: { stage: "LIMIT", inputStage: indexedPlan } }],
                            },
                        },
                    })
                ).toBe(true);
            });

            it.each([true, false])("should reject a collection scan in any shard (first: %s)", (first) => {
                const shards = [{ winningPlan: indexedPlan }, { winningPlan: { stage: "COLLSCAN" } }];
                expect(
                    usesIndex({
                        queryPlanner: {
                            winningPlan: { stage: "SHARD_MERGE", shards: first ? shards.reverse() : shards },
                        },
                    })
                ).toBe(false);
            });

            it.each([
                { shards: [] },
                { shards: [null] },
                { shards: [{}] },
                { shards: [{ winningPlan: {} }] },
                { shards: [{ winningPlan: { stage: "UNKNOWN_STAGE" } }] },
                { shards: [{ winningPlan: indexedPlan }, {}] },
                { shards: [{ winningPlan: indexedPlan }, null] },
                { shards: {} },
            ])("should conservatively reject incomplete shard plans: %j", ({ shards }) => {
                expect(usesIndex({ queryPlanner: { winningPlan: { stage: "SINGLE_SHARD", shards } } })).toBe(false);
            });

            it.each([
                "IXSCAN",
                "COUNT_SCAN",
                "EXPRESS_IXSCAN",
                "EXPRESS_CLUSTERED_IXSCAN",
                "EXPRESS_UPDATE",
                "EXPRESS_DELETE",
                "IDHACK",
            ])("should preserve support for %s inside a shard", (stage) => {
                expect(
                    usesIndex({
                        queryPlanner: { winningPlan: { stage: "SINGLE_SHARD", shards: [{ winningPlan: { stage } }] } },
                    })
                ).toBe(true);
            });

            it("should inspect slot-based queryPlan wrappers inside shard winning plans", () => {
                expect(
                    usesIndex({
                        queryPlanner: {
                            winningPlan: {
                                stage: "SHARD_MERGE",
                                shards: [
                                    { winningPlan: { queryPlan: indexedPlan, slotBasedPlan: { stages: "opaque" } } },
                                ],
                            },
                        },
                    })
                ).toBe(true);
            });

            it("should inspect a slot-based wrapper around the sharded winning plan", () => {
                expect(
                    usesIndex({
                        queryPlanner: {
                            winningPlan: {
                                queryPlan: { stage: "SINGLE_SHARD", shards: [{ winningPlan: indexedPlan }] },
                            },
                        },
                    })
                ).toBe(true);
            });

            it("should not accept rejected shard plans instead of the winning plan", () => {
                expect(
                    usesIndex({
                        queryPlanner: {
                            winningPlan: {
                                stage: "SINGLE_SHARD",
                                shards: [{ winningPlan: { stage: "COLLSCAN" }, rejectedPlans: [indexedPlan] }],
                            },
                        },
                    })
                ).toBe(false);
            });
        });

        it("should return true for IXSCAN", () => {
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: "IXSCAN",
                    },
                },
            };
            expect(usesIndex(explainResult)).toBe(true);
        });

        it("should return true for COUNT_SCAN", () => {
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: "COUNT_SCAN",
                    },
                },
            };
            expect(usesIndex(explainResult)).toBe(true);
        });

        it("should return true for IDHACK", () => {
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: "IDHACK",
                    },
                },
            };
            expect(usesIndex(explainResult)).toBe(true);
        });

        it("should return true for EXPRESS_IXSCAN (MongoDB 8.0+)", () => {
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: "EXPRESS_IXSCAN",
                    },
                },
            };
            expect(usesIndex(explainResult)).toBe(true);
        });

        it("should return true for EXPRESS_CLUSTERED_IXSCAN (MongoDB 8.0+)", () => {
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: "EXPRESS_CLUSTERED_IXSCAN",
                    },
                },
            };
            expect(usesIndex(explainResult)).toBe(true);
        });

        it("should return true for EXPRESS_UPDATE (MongoDB 8.0+)", () => {
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: "EXPRESS_UPDATE",
                    },
                },
            };
            expect(usesIndex(explainResult)).toBe(true);
        });

        it("should return true for EXPRESS_DELETE (MongoDB 8.0+)", () => {
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: "EXPRESS_DELETE",
                    },
                },
            };
            expect(usesIndex(explainResult)).toBe(true);
        });

        it("should return false for COLLSCAN", () => {
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: "COLLSCAN",
                    },
                },
            };
            expect(usesIndex(explainResult)).toBe(false);
        });

        it("should return true for nested IXSCAN in inputStage", () => {
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: "LIMIT",
                        inputStage: {
                            stage: "IXSCAN",
                        },
                    },
                },
            };
            expect(usesIndex(explainResult)).toBe(true);
        });

        it("should return true for nested EXPRESS_IXSCAN in inputStage", () => {
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: "SORT",
                        inputStage: {
                            stage: "EXPRESS_IXSCAN",
                        },
                    },
                },
            };
            expect(usesIndex(explainResult)).toBe(true);
        });

        it("should return false for unknown stage types", () => {
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: "UNKNOWN_STAGE",
                    },
                },
            };
            expect(usesIndex(explainResult)).toBe(false);
        });

        it("should handle missing queryPlanner", () => {
            const explainResult: Document = {};
            expect(usesIndex(explainResult)).toBe(false);
        });
    });

    describe("checkIndexUsage", () => {
        it.each(["IXSCAN", "COLLSCAN"])("should enforce index checks across all shards: %s", async (stage) => {
            const logger = new CompositeLogger();
            const warning = vi.spyOn(logger, "warning");
            const explainCallback = vi.fn().mockResolvedValue({
                queryPlanner: {
                    winningPlan: {
                        stage: "SHARD_MERGE",
                        shards: [{ winningPlan: { stage: "IXSCAN" } }, { winningPlan: { stage } }],
                    },
                },
            });
            const result = checkIndexUsage({
                database: "db",
                collection: "coll",
                operation: "find",
                explainCallback,
                logger,
            });
            if (stage === "IXSCAN") {
                await expect(result).resolves.toBeUndefined();
            } else {
                await expect(result).rejects.toMatchObject({ code: ErrorCodes.ForbiddenCollscan });
            }
            expect(explainCallback).toHaveBeenCalledExactlyOnceWith();
            expect(warning).not.toHaveBeenCalled();
        });
    });

    describe("getIndexCheckErrorMessage", () => {
        it("should generate appropriate error message", () => {
            const message = getIndexCheckErrorMessage({
                database: "testdb",
                collection: "testcoll",
                operation: "find",
            });
            expect(message).toContain("Index check failed");
            expect(message).toContain("testdb.testcoll");
            expect(message).toContain("find operation");
            expect(message).toContain("collection scan (COLLSCAN)");
            expect(message).toContain("MDB_MCP_INDEX_CHECK");
        });
    });
});
