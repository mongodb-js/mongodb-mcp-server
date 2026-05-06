import { describe, expect, it } from "vitest";
import {
    buildAutoScaling,
    buildReplicationSpec,
    buildClusterBody,
    validateSharedArgs,
} from "../../src/tools/atlas/create/clusterShared.js";

describe("clusterShared", () => {
    describe("buildAutoScaling", () => {
        it("enables compute scaling when instanceSize is undefined", () => {
            const result = buildAutoScaling(undefined, "M10", "M200", true);
            expect(result.compute).toEqual({
                enabled: true,
                scaleDownEnabled: true,
                minInstanceSize: "M10",
                maxInstanceSize: "M200",
            });
            expect(result.diskGBEnabled).toBe(true);
        });

        it("omits compute field when instanceSize is fixed", () => {
            const result = buildAutoScaling("M30", "M10", "M200", false);
            expect(result.compute).toBeUndefined();
            expect(result.diskGBEnabled).toBe(false);
        });

        it("passes diskGBEnabled through in both modes", () => {
            expect(buildAutoScaling(undefined, "M10", "M200", false).diskGBEnabled).toBe(false);
            expect(buildAutoScaling("M30", "M10", "M200", true).diskGBEnabled).toBe(true);
        });
    });

    describe("buildReplicationSpec", () => {
        it("builds a single-region spec with auto-scaling", () => {
            const spec = buildReplicationSpec(
                [{ name: "US_EAST_1", provider: "AWS", priority: 7, nodeCount: 3 }],
                undefined,
                "M10",
                "M200",
                true
            );
            expect(spec.regionConfigs).toHaveLength(1);
            const [config] = spec.regionConfigs;
            expect(config.regionName).toBe("US_EAST_1");
            expect(config.providerName).toBe("AWS");
            expect(config.priority).toBe(7);
            expect(config.electableSpecs).toEqual({ instanceSize: "M10", nodeCount: 3 });
            expect(config.autoScaling.compute).toBeDefined();
        });

        it("builds a multi-region spec preserving per-region priority and nodeCount", () => {
            const spec = buildReplicationSpec(
                [
                    { name: "US_EAST_1", provider: "AWS", priority: 7, nodeCount: 3 },
                    { name: "EU_WEST_1", provider: "AWS", priority: 6, nodeCount: 2 },
                ],
                undefined,
                "M10",
                "M200",
                true
            );
            expect(spec.regionConfigs).toHaveLength(2);
            expect(spec.regionConfigs[1].regionName).toBe("EU_WEST_1");
            expect(spec.regionConfigs[1].priority).toBe(6);
            expect(spec.regionConfigs[1].electableSpecs.nodeCount).toBe(2);
        });

        it("uses fixed instanceSize in electableSpecs and disables compute scaling", () => {
            const spec = buildReplicationSpec(
                [{ name: "US_EAST_1", provider: "AWS", priority: 7, nodeCount: 3 }],
                "M30",
                "M10",
                "M200",
                true
            );
            expect(spec.regionConfigs[0].electableSpecs.instanceSize).toBe("M30");
            expect(spec.regionConfigs[0].autoScaling.compute).toBeUndefined();
        });

        it("supports cross-provider regions", () => {
            const spec = buildReplicationSpec(
                [
                    { name: "US_EAST_1", provider: "AWS", priority: 7, nodeCount: 3 },
                    { name: "northeurope", provider: "AZURE", priority: 6, nodeCount: 3 },
                ],
                undefined,
                "M10",
                "M200",
                true
            );
            expect(spec.regionConfigs[0].providerName).toBe("AWS");
            expect(spec.regionConfigs[1].providerName).toBe("AZURE");
        });
    });

    describe("buildClusterBody", () => {
        const singleRegionSpec = buildReplicationSpec(
            [{ name: "US_EAST_1", provider: "AWS", priority: 7, nodeCount: 3 }],
            undefined,
            "M10",
            "M200",
            true
        );

        it("builds a basic REPLICASET body with expected fields", () => {
            const body = buildClusterBody(
                "my-cluster",
                "REPLICASET",
                false,
                false,
                undefined,
                undefined,
                {},
                false,
                singleRegionSpec
            );
            expect(body.name).toBe("my-cluster");
            expect(body.clusterType).toBe("REPLICASET");
            expect(body.backupEnabled).toBe(false);
            expect(body.pitEnabled).toBe(false);
            expect(body.terminationProtectionEnabled).toBe(false);
            expect(body.paused).toBe(false);
            expect(body.replicationSpecs).toHaveLength(1);
            expect(body.diskSizeGB).toBeUndefined();
        });

        it("includes diskSizeGB when provided", () => {
            const body = buildClusterBody(
                "c",
                "REPLICASET",
                false,
                false,
                50,
                undefined,
                {},
                false,
                singleRegionSpec
            );
            expect(body.diskSizeGB).toBe(50);
        });

        it("omits diskSizeGB when not provided", () => {
            const body = buildClusterBody(
                "c",
                "REPLICASET",
                false,
                false,
                undefined,
                undefined,
                {},
                false,
                singleRegionSpec
            );
            expect("diskSizeGB" in body).toBe(false);
        });

        it("converts tags from record to {key, value} array", () => {
            const body = buildClusterBody(
                "c",
                "REPLICASET",
                false,
                false,
                undefined,
                undefined,
                { Environment: "prod", Team: "infra" },
                false,
                singleRegionSpec
            );
            expect(body.tags).toHaveLength(2);
            expect(body.tags).toEqual(
                expect.arrayContaining([
                    { key: "Environment", value: "prod" },
                    { key: "Team", value: "infra" },
                ])
            );
        });

        it("produces empty tags array when no tags provided", () => {
            const body = buildClusterBody(
                "c",
                "REPLICASET",
                false,
                false,
                undefined,
                undefined,
                {},
                false,
                singleRegionSpec
            );
            expect(body.tags).toEqual([]);
        });

        it("passes terminationProtectionEnabled through", () => {
            const body = buildClusterBody(
                "c",
                "REPLICASET",
                false,
                false,
                undefined,
                undefined,
                {},
                true,
                singleRegionSpec
            );
            expect(body.terminationProtectionEnabled).toBe(true);
        });

        it("creates one replicationSpec per shard for SHARDED cluster", () => {
            const body = buildClusterBody(
                "c",
                "SHARDED",
                false,
                false,
                undefined,
                3,
                {},
                false,
                singleRegionSpec
            );
            expect(body.replicationSpecs).toHaveLength(3);
        });

        it("defaults to 1 shard for SHARDED cluster when shardCount is undefined", () => {
            const body = buildClusterBody(
                "c",
                "SHARDED",
                false,
                false,
                undefined,
                undefined,
                {},
                false,
                singleRegionSpec
            );
            expect(body.replicationSpecs).toHaveLength(1);
        });

        it("always creates 1 replicationSpec for REPLICASET", () => {
            const body = buildClusterBody(
                "c",
                "REPLICASET",
                false,
                false,
                undefined,
                undefined,
                {},
                false,
                singleRegionSpec
            );
            expect(body.replicationSpecs).toHaveLength(1);
        });

        it("sets backupEnabled and pitEnabled", () => {
            const body = buildClusterBody(
                "c",
                "REPLICASET",
                true,
                true,
                undefined,
                undefined,
                {},
                false,
                singleRegionSpec
            );
            expect(body.backupEnabled).toBe(true);
            expect(body.pitEnabled).toBe(true);
        });
    });

    describe("validateSharedArgs", () => {
        it("returns null for valid args with no optional fields", () => {
            expect(
                validateSharedArgs({ pitEnabled: false, backupEnabled: false, clusterType: "REPLICASET" })
            ).toBeNull();
        });

        it("returns null when pitEnabled and backupEnabled are both true", () => {
            expect(
                validateSharedArgs({ pitEnabled: true, backupEnabled: true, clusterType: "REPLICASET" })
            ).toBeNull();
        });

        it("returns null when shardCount is set on SHARDED cluster", () => {
            expect(
                validateSharedArgs({
                    pitEnabled: false,
                    backupEnabled: false,
                    clusterType: "SHARDED",
                    shardCount: 2,
                })
            ).toBeNull();
        });

        it("returns error when pitEnabled=true without backupEnabled", () => {
            const result = validateSharedArgs({ pitEnabled: true, backupEnabled: false, clusterType: "REPLICASET" });
            expect(result).not.toBeNull();
            expect(result?.isError).toBe(true);
            expect(result?.content[0]).toMatchObject({
                type: "text",
                text: expect.stringContaining("pitEnabled requires backupEnabled"),
            });
        });

        it("returns error when shardCount is set on REPLICASET cluster", () => {
            const result = validateSharedArgs({
                pitEnabled: false,
                backupEnabled: false,
                clusterType: "REPLICASET",
                shardCount: 2,
            });
            expect(result).not.toBeNull();
            expect(result?.isError).toBe(true);
            expect(result?.content[0]).toMatchObject({
                type: "text",
                text: expect.stringContaining("shardCount is only valid"),
            });
        });

        it("pitEnabled check takes precedence over shardCount check", () => {
            const result = validateSharedArgs({
                pitEnabled: true,
                backupEnabled: false,
                clusterType: "REPLICASET",
                shardCount: 2,
            });
            expect(result?.content[0].text).toContain("pitEnabled requires backupEnabled");
        });
    });
});
