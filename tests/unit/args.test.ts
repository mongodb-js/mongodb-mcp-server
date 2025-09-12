import { describe, expect, it } from "vitest";
import {
    AtlasArgs,
    CommonArgs,
    ALLOWED_PROJECT_NAME_CHARACTERS_ERROR,
    ALLOWED_USERNAME_CHARACTERS_ERROR,
    ALLOWED_REGION_CHARACTERS_ERROR,
    ALLOWED_CLUSTER_NAME_CHARACTERS_ERROR,
    NO_UNICODE_ERROR,
} from "../../src/tools/args.js";

describe("Tool args", () => {
    describe("CommonArgs", () => {
        describe("string", () => {
            it("should return a ZodString schema", () => {
                const schema = CommonArgs.string();
                expect(schema).toBeDefined();
                expect(schema.parse("test")).toBe("test");
            });

            it("should accept any string value", () => {
                const schema = CommonArgs.string();
                expect(schema.parse("hello")).toBe("hello");
                expect(schema.parse("123")).toBe("123");
                expect(schema.parse("test@#$%")).toBe("test@#$%");
            });

            it("should not allow special characters and unicode symbols", () => {
                const schema = CommonArgs.string();

                // Unicode characters
                expect(() => schema.parse("héllo")).toThrow(NO_UNICODE_ERROR);
                expect(() => schema.parse("测试")).toThrow(NO_UNICODE_ERROR);
                expect(() => schema.parse("café")).toThrow(NO_UNICODE_ERROR);

                // Emojis
                expect(() => schema.parse("🚀")).toThrow(NO_UNICODE_ERROR);
                expect(() => schema.parse("hello😀")).toThrow(NO_UNICODE_ERROR);

                // Control characters (below ASCII 32)
                expect(() => schema.parse("hello\nworld")).toThrow(NO_UNICODE_ERROR);
                expect(() => schema.parse("hello\tworld")).toThrow(NO_UNICODE_ERROR);
                expect(() => schema.parse("hello\0world")).toThrow(NO_UNICODE_ERROR);

                // Extended ASCII characters (above ASCII 126)
                expect(() => schema.parse("hello\x80")).toThrow(NO_UNICODE_ERROR);
                expect(() => schema.parse("hello\xFF")).toThrow(NO_UNICODE_ERROR);
            });

            it("should reject non-string values", () => {
                const schema = CommonArgs.string();
                expect(() => schema.parse(123)).toThrow();
                expect(() => schema.parse(null)).toThrow();
                expect(() => schema.parse(undefined)).toThrow();
                expect(() => schema.parse({})).toThrow();
            });
        });

        describe("objectId", () => {
            it("should validate 24-character hexadecimal strings", () => {
                const schema = CommonArgs.objectId("Test ID");
                const validId = "507f1f77bcf86cd799439011";
                expect(schema.parse(validId)).toBe(validId);
            });

            it("should reject invalid ObjectId formats", () => {
                const schema = CommonArgs.objectId("Test ID");

                // Too short
                expect(() => schema.parse("507f1f77bcf86cd79943901")).toThrow();

                // Too long
                expect(() => schema.parse("507f1f77bcf86cd7994390111")).toThrow();

                // Invalid characters
                expect(() => schema.parse("507f1f77bcf86cd79943901g")).toThrow();
                expect(() => schema.parse("507f1f77bcf86cd79943901!")).toThrow();

                // Empty string
                expect(() => schema.parse("")).toThrow();
            });

            it("should provide custom field name in error messages", () => {
                const schema = CommonArgs.objectId("Custom Field");
                expect(() => schema.parse("invalid")).toThrow("Custom Field must be exactly 24 characters");
            });

            it("should not fail if the value is optional", () => {
                const schema = CommonArgs.objectId("Custom Field").optional();
                expect(schema.parse(undefined)).toBeUndefined();
            });

            it("should not fail if the value is empty", () => {
                const schema = CommonArgs.objectId("Custom Field");
                expect(() => schema.parse(undefined)).toThrow("Required");
            });
        });
    });

    describe("AtlasArgs", () => {
        describe("projectId", () => {
            it("should validate project IDs", () => {
                const schema = AtlasArgs.projectId();
                const validId = "507f1f77bcf86cd799439011";
                expect(schema.parse(validId)).toBe(validId);
            });

            it("should reject invalid project IDs", () => {
                const schema = AtlasArgs.projectId();
                expect(() => schema.parse("invalid")).toThrow("projectId must be exactly 24 characters");
                expect(() => schema.parse("507f1f77bc*86cd79943901")).toThrow(
                    "projectId must contain only hexadecimal characters"
                );
                expect(() => schema.parse("")).toThrow("projectId is required");
                expect(() => schema.parse("507f1f77/bcf86cd799439011")).toThrow(
                    "projectId must contain only hexadecimal characters"
                );
            });
        });

        describe("organizationId", () => {
            it("should validate organization IDs", () => {
                const schema = AtlasArgs.organizationId();
                const validId = "507f1f77bcf86cd799439011";
                expect(schema.parse(validId)).toBe(validId);
            });

            it("should reject invalid organization IDs", () => {
                const schema = AtlasArgs.organizationId();
                expect(() => schema.parse("invalid")).toThrow("organizationId must be exactly 24 characters");
            });
        });

        describe("clusterName", () => {
            it("should validate valid cluster names", () => {
                const schema = AtlasArgs.clusterName();
                const validNames = ["my-cluster", "cluster_1", "Cluster123", "test-cluster-2", "my_cluster_name"];

                validNames.forEach((name) => {
                    expect(schema.parse(name)).toBe(name);
                });
            });

            it("should reject invalid cluster names", () => {
                const schema = AtlasArgs.clusterName();

                // Empty string
                expect(() => schema.parse("")).toThrow("Cluster name is required");

                // Too long (over 64 characters)
                const longName = "a".repeat(65);
                expect(() => schema.parse(longName)).toThrow("Cluster name must be 64 characters or less");

                // Invalid characters
                expect(() => schema.parse("cluster@name")).toThrow(ALLOWED_CLUSTER_NAME_CHARACTERS_ERROR);
                expect(() => schema.parse("cluster name")).toThrow(ALLOWED_CLUSTER_NAME_CHARACTERS_ERROR);
                expect(() => schema.parse("cluster.name")).toThrow(ALLOWED_CLUSTER_NAME_CHARACTERS_ERROR);
                expect(() => schema.parse("cluster/name")).toThrow(ALLOWED_CLUSTER_NAME_CHARACTERS_ERROR);
            });

            it("should accept exactly 64 characters", () => {
                const schema = AtlasArgs.clusterName();
                const maxLengthName = "a".repeat(64);
                expect(schema.parse(maxLengthName)).toBe(maxLengthName);
            });
        });

        describe("username", () => {
            it("should validate valid usernames", () => {
                const schema = AtlasArgs.username();
                const validUsernames = ["user123", "user_name", "user.name", "user-name", "User123", "test.user_name"];

                validUsernames.forEach((username) => {
                    expect(schema.parse(username)).toBe(username);
                });
            });

            it("should reject invalid usernames", () => {
                const schema = AtlasArgs.username();

                // Empty string
                expect(() => schema.parse("")).toThrow("Username is required");

                // Too long (over 100 characters)
                const longUsername = "a".repeat(101);
                expect(() => schema.parse(longUsername)).toThrow("Username must be 100 characters or less");

                // Invalid characters
                expect(() => schema.parse("user@name")).toThrow(ALLOWED_USERNAME_CHARACTERS_ERROR);
                expect(() => schema.parse("user name")).toThrow(ALLOWED_USERNAME_CHARACTERS_ERROR);
            });

            it("should accept exactly 100 characters", () => {
                const schema = AtlasArgs.username();
                const maxLengthUsername = "a".repeat(100);
                expect(schema.parse(maxLengthUsername)).toBe(maxLengthUsername);
            });
        });

        describe("ipAddress", () => {
            it("should validate valid IPv4 addresses", () => {
                const schema = AtlasArgs.ipAddress();
                const validIPs = ["192.168.1.1", "10.0.0.1", "172.16.0.1", "127.0.0.1", "0.0.0.0", "255.255.255.255"];

                validIPs.forEach((ip) => {
                    expect(schema.parse(ip)).toBe(ip);
                });
            });

            it("should reject invalid IP addresses", () => {
                const schema = AtlasArgs.ipAddress();

                // Invalid formats
                expect(() => schema.parse("192.168.1")).toThrow();
                expect(() => schema.parse("192.168.1.1.1")).toThrow();
                expect(() => schema.parse("192.168.1.256")).toThrow();
                expect(() => schema.parse("192.168.1.-1")).toThrow();
                expect(() => schema.parse("not-an-ip")).toThrow();

                // IPv6 (should be rejected since we only support IPv4)
                expect(() => schema.parse("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toThrow();
            });
        });

        describe("cidrBlock", () => {
            it("should validate valid CIDR blocks", () => {
                const schema = AtlasArgs.cidrBlock();
                const validCIDRs = ["192.168.1.0/24", "10.0.0.0/8", "172.16.0.0/12", "0.0.0.0/0", "192.168.1.1/32"];

                validCIDRs.forEach((cidr) => {
                    expect(schema.parse(cidr)).toBe(cidr);
                });
            });

            it("should reject invalid CIDR blocks", () => {
                const schema = AtlasArgs.cidrBlock();

                // Invalid formats
                expect(() => schema.parse("192.168.1.0")).toThrow("Invalid cidr");
                expect(() => schema.parse("192.168.1.0/")).toThrow("Invalid cidr");
                expect(() => schema.parse("192.168.1.0/33")).toThrow("Invalid cidr");
                expect(() => schema.parse("192.168.1.256/24")).toThrow("Invalid cidr");
                expect(() => schema.parse("not-a-cidr")).toThrow("Invalid cidr");
            });
        });

        describe("region", () => {
            it("should validate valid region names", () => {
                const schema = AtlasArgs.region();
                const validRegions = [
                    "US_EAST_1",
                    "us-west-2",
                    "eu-central-1",
                    "ap-southeast-1",
                    "region_123",
                    "test-region",
                ];

                validRegions.forEach((region) => {
                    expect(schema.parse(region)).toBe(region);
                });
            });

            it("should accept exactly 50 characters", () => {
                const schema = AtlasArgs.region();
                const maxLengthRegion = "a".repeat(50);
                expect(schema.parse(maxLengthRegion)).toBe(maxLengthRegion);
            });

            it("should reject invalid region names", () => {
                const schema = AtlasArgs.region();

                // Empty string
                expect(() => schema.parse("")).toThrow("Region is required");

                // Too long (over 50 characters)
                const longRegion = "a".repeat(51);
                expect(() => schema.parse(longRegion)).toThrow("Region must be 50 characters or less");

                // Invalid characters
                expect(() => schema.parse("US EAST 1")).toThrow(ALLOWED_REGION_CHARACTERS_ERROR);
                expect(() => schema.parse("US.EAST.1")).toThrow(ALLOWED_REGION_CHARACTERS_ERROR);
                expect(() => schema.parse("US@EAST#1")).toThrow(ALLOWED_REGION_CHARACTERS_ERROR);
            });
        });

        describe("projectName", () => {
            it("should validate valid project names", () => {
                const schema = AtlasArgs.projectName();
                const validNames = [
                    "my-project",
                    "project_1",
                    "Project123",
                    "test-project-2",
                    "my_project_name",
                    "project with spaces",
                    "project(with)parentheses",
                    "project@with@at",
                    "project&with&ampersand",
                    "project+with+plus",
                    "project:with:colon",
                    "project.with.dots",
                    "project'with'apostrophe",
                    "project,with,comma",
                    "complex project (with) @all &symbols+here:test.name'value,",
                ];

                validNames.forEach((name) => {
                    expect(schema.parse(name)).toBe(name);
                });
            });

            it("should reject invalid project names", () => {
                const schema = AtlasArgs.projectName();

                // Empty string
                expect(() => schema.parse("")).toThrow("Project name is required");

                // Too long (over 64 characters)
                expect(() => schema.parse("a".repeat(65))).toThrow("Project name must be 64 characters or less");

                // Invalid characters not in the allowed set
                expect(() => schema.parse("project#with#hash")).toThrow(ALLOWED_PROJECT_NAME_CHARACTERS_ERROR);
                expect(() => schema.parse("project$with$dollar")).toThrow(ALLOWED_PROJECT_NAME_CHARACTERS_ERROR);
                expect(() => schema.parse("project!with!exclamation")).toThrow(ALLOWED_PROJECT_NAME_CHARACTERS_ERROR);
                expect(() => schema.parse("project[with]brackets")).toThrow(ALLOWED_PROJECT_NAME_CHARACTERS_ERROR);
            });

            it("should accept exactly 64 characters", () => {
                const schema = AtlasArgs.projectName();
                const maxLengthName = "a".repeat(64);
                expect(schema.parse(maxLengthName)).toBe(maxLengthName);
            });
        });

        describe("password", () => {
            it("should validate valid passwords", () => {
                const schema = AtlasArgs.password().optional();
                const validPasswords = ["password123", "password_123", "Password123", "test-password-123"];
                validPasswords.forEach((password) => {
                    expect(schema.parse(password)).toBe(password);
                });
                expect(schema.parse(undefined)).toBeUndefined();
            });

            it("should reject invalid passwords", () => {
                const schema = AtlasArgs.password();
                expect(() => schema.parse("")).toThrow("Password is required");
                expect(() => schema.parse("a".repeat(101))).toThrow("Password must be 100 characters or less");
            });
        });
    });

    describe("Edge Cases and Security", () => {
        it("should handle empty strings appropriately", () => {
            const schema = CommonArgs.string();
            expect(schema.parse("")).toBe("");

            // But AtlasArgs validators should reject empty strings
            expect(() => AtlasArgs.clusterName().parse("")).toThrow();
            expect(() => AtlasArgs.username().parse("")).toThrow();
        });

        it("should handle very long strings", () => {
            const schema = CommonArgs.string();
            const longString = "a".repeat(10000);
            expect(schema.parse(longString)).toBe(longString);

            // But AtlasArgs validators should enforce length limits
            expect(() => AtlasArgs.clusterName().parse("a".repeat(65))).toThrow();
            expect(() => AtlasArgs.username().parse("a".repeat(101))).toThrow();
        });

        it("should handle null and undefined values", () => {
            const schema = CommonArgs.string();
            expect(() => schema.parse(null)).toThrow();
            expect(() => schema.parse(undefined)).toThrow();
        });
    });

    describe("Error Messages", () => {
        it("should provide clear error messages for validation failures", () => {
            // Test specific error messages
            expect(() => AtlasArgs.clusterName().parse("")).toThrow("Cluster name is required");
            expect(() => AtlasArgs.clusterName().parse("a".repeat(65))).toThrow(
                "Cluster name must be 64 characters or less"
            );
            expect(() => AtlasArgs.clusterName().parse("invalid@name")).toThrow(ALLOWED_CLUSTER_NAME_CHARACTERS_ERROR);

            expect(() => AtlasArgs.username().parse("")).toThrow("Username is required");
            expect(() => AtlasArgs.username().parse("a".repeat(101))).toThrow(
                "Username must be 100 characters or less"
            );
            expect(() => AtlasArgs.username().parse("invalid name")).toThrow(ALLOWED_USERNAME_CHARACTERS_ERROR);
        });
    });
});
