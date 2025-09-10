import { describe, expect, it } from "vitest";
import { AtlasArgs, CommonArgs } from "../../src/tools/args.js";

describe("Atlas Validators", () => {
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
                expect(() => schema.parse("héllo")).toThrow();
                expect(() => schema.parse("测试")).toThrow();
                expect(() => schema.parse("🚀")).toThrow();
            });

            it("should reject non-string values", () => {
                const schema = CommonArgs.string();
                expect(() => schema.parse(123)).toThrow();
                expect(() => schema.parse(null)).toThrow();
                expect(() => schema.parse(undefined)).toThrow();
                expect(() => schema.parse({})).toThrow();
            });
        });
    });

    describe("AtlasArgs", () => {
        describe("objectId", () => {
            it("should validate 24-character hexadecimal strings", () => {
                const schema = AtlasArgs.objectId("Test ID");
                const validId = "507f1f77bcf86cd799439011";
                expect(schema.parse(validId)).toBe(validId);
            });

            it("should reject invalid ObjectId formats", () => {
                const schema = AtlasArgs.objectId("Test ID");

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
                const schema = AtlasArgs.objectId("Custom Field");
                expect(() => schema.parse("invalid")).toThrow(
                    "Custom Field must be a valid 24-character hexadecimal string"
                );
            });

            it("should not faile if the value is optional", () => {
                const schema = AtlasArgs.objectId("Custom Field").optional();
                expect(schema.parse(undefined)).toBeUndefined();
            });

            it("should not fail if the value is empty", () => {
                const schema = AtlasArgs.objectId("Custom Field");
                expect(() => schema.parse(undefined)).toThrow("Required");
            });
        });

        describe("projectId", () => {
            it("should validate project IDs", () => {
                const schema = AtlasArgs.projectId();
                const validId = "507f1f77bcf86cd799439011";
                expect(schema.parse(validId)).toBe(validId);
            });

            it("should reject invalid project IDs", () => {
                const schema = AtlasArgs.projectId();
                expect(() => schema.parse("invalid")).toThrow(
                    "projectId must be a valid 24-character hexadecimal string"
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
                expect(() => schema.parse("invalid")).toThrow(
                    "organizationId must be a valid 24-character hexadecimal string"
                );
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
                expect(() => schema.parse("cluster@name")).toThrow(
                    "Cluster name can only contain letters, numbers, hyphens, and underscores"
                );
                expect(() => schema.parse("cluster name")).toThrow(
                    "Cluster name can only contain letters, numbers, hyphens, and underscores"
                );
                expect(() => schema.parse("cluster.name")).toThrow(
                    "Cluster name can only contain letters, numbers, hyphens, and underscores"
                );
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
                expect(() => schema.parse("user@name")).toThrow(
                    "Username can only contain letters, numbers, dots, hyphens, and underscores"
                );
                expect(() => schema.parse("user name")).toThrow(
                    "Username can only contain letters, numbers, dots, hyphens, and underscores"
                );
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

            it("should reject invalid region names", () => {
                const schema = AtlasArgs.region();

                // Invalid characters
                expect(() => schema.parse("US EAST 1")).toThrow(
                    "Region can only contain letters, numbers, hyphens, and underscores"
                );
                expect(() => schema.parse("US.EAST.1")).toThrow(
                    "Region can only contain letters, numbers, hyphens, and underscores"
                );
                expect(() => schema.parse("US@EAST#1")).toThrow(
                    "Region can only contain letters, numbers, hyphens, and underscores"
                );
            });
        });

        describe("projectName", () => {
            it("should validate valid project names", () => {
                const schema = AtlasArgs.projectName();
                const validNames = ["my-project", "project_1", "Project123", "test-project-2", "my_project_name"];

                validNames.forEach((name) => {
                    expect(schema.parse(name)).toBe(name);
                });
            });

            it("should reject invalid project names", () => {
                const schema = AtlasArgs.projectName();
                expect(() => schema.parse("")).toThrow("Project name is required");
                expect(() => schema.parse("a".repeat(65))).toThrow("Project name must be 64 characters or less");
                expect(() => schema.parse("invalid@name")).toThrow(
                    "Project name can only contain letters, numbers, hyphens, and underscores"
                );
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
            expect(() => AtlasArgs.clusterName().parse("invalid@name")).toThrow(
                "Cluster name can only contain letters, numbers, hyphens, and underscores"
            );

            expect(() => AtlasArgs.username().parse("")).toThrow("Username is required");
            expect(() => AtlasArgs.username().parse("a".repeat(101))).toThrow(
                "Username must be 100 characters or less"
            );
            expect(() => AtlasArgs.username().parse("invalid name")).toThrow(
                "Username can only contain letters, numbers, dots, hyphens, and underscores"
            );
        });
    });
});
