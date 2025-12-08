import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ListDatabasesOutputSchema } from "../../../../../src/ui/components/ListDatabases/schema.js";

describe("ListDatabasesOutputSchema", () => {
    const schema = z.object(ListDatabasesOutputSchema);

    describe("valid data", () => {
        it("should validate data with empty databases array", () => {
            const data = {
                databases: [],
                totalCount: 0,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.databases).toEqual([]);
                expect(result.data.totalCount).toBe(0);
            }
        });

        it("should validate data with single database", () => {
            const data = {
                databases: [{ name: "admin", size: 1024 }],
                totalCount: 1,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.databases).toHaveLength(1);
                expect(result.data.databases[0]).toEqual({ name: "admin", size: 1024 });
            }
        });

        it("should validate data with multiple databases", () => {
            const data = {
                databases: [
                    { name: "admin", size: 1024 },
                    { name: "local", size: 2048 },
                    { name: "config", size: 512 },
                ],
                totalCount: 3,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.databases).toHaveLength(3);
                expect(result.data.totalCount).toBe(3);
            }
        });

        it("should validate data with zero size", () => {
            const data = {
                databases: [{ name: "empty-db", size: 0 }],
                totalCount: 1,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(true);
        });

        it("should validate data with large size values", () => {
            const data = {
                databases: [{ name: "large-db", size: Number.MAX_SAFE_INTEGER }],
                totalCount: 1,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(true);
        });

        it("should validate data with special characters in database name", () => {
            const data = {
                databases: [{ name: "my-test_db.2024", size: 1024 }],
                totalCount: 1,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(true);
        });
    });

    describe("invalid data", () => {
        it("should fail validation when databases is missing", () => {
            const data = {
                totalCount: 0,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues.some((issue) => issue.path.includes("databases"))).toBe(true);
            }
        });

        it("should fail validation when totalCount is missing", () => {
            const data = {
                databases: [],
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues.some((issue) => issue.path.includes("totalCount"))).toBe(true);
            }
        });

        it("should fail validation when databases is not an array", () => {
            const data = {
                databases: "not-an-array",
                totalCount: 0,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(false);
        });

        it("should fail validation when totalCount is not a number", () => {
            const data = {
                databases: [],
                totalCount: "not-a-number",
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(false);
        });

        it("should fail validation when database name is missing", () => {
            const data = {
                databases: [{ size: 1024 }],
                totalCount: 1,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues.some((issue) => issue.path.includes("name"))).toBe(true);
            }
        });

        it("should fail validation when database size is missing", () => {
            const data = {
                databases: [{ name: "admin" }],
                totalCount: 1,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues.some((issue) => issue.path.includes("size"))).toBe(true);
            }
        });

        it("should fail validation when database name is not a string", () => {
            const data = {
                databases: [{ name: 123, size: 1024 }],
                totalCount: 1,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(false);
        });

        it("should fail validation when database size is not a number", () => {
            const data = {
                databases: [{ name: "admin", size: "1024" }],
                totalCount: 1,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(false);
        });

        it("should fail validation when databases is null", () => {
            const data = {
                databases: null,
                totalCount: 0,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(false);
        });

        it("should fail validation when totalCount is null", () => {
            const data = {
                databases: [],
                totalCount: null,
            };

            const result = schema.safeParse(data);
            expect(result.success).toBe(false);
        });
    });
});
