import { describe, expect, it } from "vitest";
import { usesIndex, getIndexCheckErrorMessage } from "../../../src/helpers/indexCheck.js";
import type { Document } from "mongodb";

describe("indexCheck", () => {
    describe("usesIndex", () => {
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

    describe("getIndexCheckErrorMessage", () => {
        it("should generate appropriate error message", () => {
            const message = getIndexCheckErrorMessage("testdb", "testcoll", "find");
            expect(message).toContain("Index check failed");
            expect(message).toContain("testdb.testcoll");
            expect(message).toContain("find operation");
            expect(message).toContain("collection scan (COLLSCAN)");
            expect(message).toContain("MDB_MCP_INDEX_CHECK");
        });
    });
});
