import { describe, it, expect } from "vitest";
import {
    getHostType,
    getAuthType,
    getConnectionStringInfo,
    type ConnectionStringAuthType,
    type AtlasClusterConnectionInfo,
} from "../../../src/common/connectionInfo.js";
import type { UserConfig } from "../../../src/common/config/userConfig.js";

describe("connectionInfo", () => {
    describe("getHostType", () => {
        it("should return 'atlas' when connection string is an Atlas connection string", () => {
            const atlasConnectionString = "mongodb+srv://user:password@cluster.mongodb.net/database";

            const result = getHostType(atlasConnectionString);

            expect(result).toBe("atlas");
        });

        it("should return 'unknown' when connection string is not an Atlas connection string", () => {
            const localConnectionString = "mongodb://localhost:27017/database";

            const result = getHostType(localConnectionString);

            expect(result).toBe("unknown");
        });

        it("should return 'unknown' for empty connection string", () => {
            const emptyConnectionString = "";

            const result = getHostType(emptyConnectionString);

            expect(result).toBe("unknown");
        });

        it("should handle Atlas connection strings with query parameters", () => {
            const atlasConnectionStringWithParams =
                "mongodb+srv://user:password@cluster.mongodb.net/database?retryWrites=true&w=majority";

            const result = getHostType(atlasConnectionStringWithParams);

            expect(result).toBe("atlas");
        });

        it("should handle standard MongoDB connection strings", () => {
            const standardConnectionString = "mongodb://user:password@host1:27017,host2:27017/database";

            const result = getHostType(standardConnectionString);

            expect(result).toBe("unknown");
        });

        it("should handle connection strings with special characters in password", () => {
            const connectionStringWithSpecialChars = "mongodb+srv://user:p%40ssw%3Drd@cluster.mongodb.net/database";

            const result = getHostType(connectionStringWithSpecialChars);

            expect(result).toBe("atlas");
        });

        it("should handle invalid connection string formats", () => {
            const invalidConnectionString = "not-a-valid-connection-string";

            const result = getHostType(invalidConnectionString);

            expect(result).toBe("unknown");
        });

        it("should handle connection strings without database name", () => {
            const connectionStringWithoutDb = "mongodb+srv://user:password@cluster.mongodb.net/";

            const result = getHostType(connectionStringWithoutDb);

            expect(result).toBe("atlas");
        });

        it("should handle private endpoint Atlas connection strings", () => {
            const privateEndpointConnectionString = "mongodb+srv://user:password@cluster.abc123.mongodb.net/database";

            const result = getHostType(privateEndpointConnectionString);

            expect(result).toBe("atlas");
        });

        it("should handle Atlas connection strings without authentication", () => {
            const atlasConnectionStringNoAuth = "mongodb+srv://cluster.mongodb.net/database";

            const result = getHostType(atlasConnectionStringNoAuth);

            expect(result).toBe("atlas");
        });

        it("should handle localhost connection strings", () => {
            const localhostConnectionString = "mongodb://127.0.0.1:27017/database";

            const result = getHostType(localhostConnectionString);

            expect(result).toBe("unknown");
        });

        it("should handle connection strings with IP addresses", () => {
            const ipConnectionString = "mongodb://192.168.1.1:27017/database";

            const result = getHostType(ipConnectionString);

            expect(result).toBe("unknown");
        });

        it("should handle Atlas connection strings with replica set (mongodb:// format)", () => {
            // mongodb:// format supports multiple hosts for replica sets
            const atlasReplicaSetConnectionString =
                "mongodb://user:password@cluster-shard-00-00.mongodb.net:27017,cluster-shard-00-01.mongodb.net:27017/database?ssl=true&replicaSet=Cluster0-shard-0";

            const result = getHostType(atlasReplicaSetConnectionString);

            expect(result).toBe("atlas");
        });

        it("should handle Atlas connection strings with replica set (mongodb+srv:// format)", () => {
            // mongodb+srv:// uses SRV records, so only a single hostname is used
            const atlasSrvConnectionString =
                "mongodb+srv://user:password@cluster.mongodb.net/database?replicaSet=Cluster0-shard-0";

            const result = getHostType(atlasSrvConnectionString);

            expect(result).toBe("atlas");
        });
    });

    describe("getAuthType", () => {
        const testCases: {
            description: string;
            userConfig: Partial<UserConfig>;
            connectionString: string;
            expectedAuthType: ConnectionStringAuthType;
        }[] = [
            {
                description: "should return 'scram' for standard connection string without auth mechanism",
                userConfig: {},
                connectionString: "mongodb://localhost:27017",
                expectedAuthType: "scram",
            },
            {
                description: "should return 'x.509' for MONGODB-X509 auth mechanism",
                userConfig: {},
                connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-X509",
                expectedAuthType: "x.509",
            },
            {
                description: "should return 'kerberos' for GSSAPI auth mechanism",
                userConfig: {},
                connectionString: "mongodb://localhost:27017?authMechanism=GSSAPI",
                expectedAuthType: "kerberos",
            },
            {
                description: "should return 'ldap' for PLAIN auth mechanism with $external authSource",
                userConfig: {},
                connectionString: "mongodb://localhost:27017?authMechanism=PLAIN&authSource=$external",
                expectedAuthType: "ldap",
            },
            {
                description: "should return 'scram' for PLAIN auth mechanism without $external authSource",
                userConfig: {},
                connectionString: "mongodb://localhost:27017?authMechanism=PLAIN",
                expectedAuthType: "scram",
            },
            {
                description: "should return 'oidc-auth-flow' for OIDC with stdio transport and browser configured",
                userConfig: { transport: "stdio", browser: "firefox" },
                connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC",
                expectedAuthType: "oidc-auth-flow",
            },
            {
                description:
                    "should return 'oidc-auth-flow' for OIDC with http transport on localhost and browser configured",
                userConfig: { transport: "http", httpHost: "127.0.0.1", browser: "chrome" },
                connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC",
                expectedAuthType: "oidc-auth-flow",
            },
            {
                description: "should return 'oidc-device-flow' for OIDC with http transport on non-localhost",
                userConfig: { transport: "http", httpHost: "0.0.0.0", browser: "chrome" },
                connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC",
                expectedAuthType: "oidc-device-flow",
            },
            {
                description: "should return 'oidc-device-flow' for OIDC with stdio transport without browser",
                userConfig: { transport: "stdio" },
                connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC",
                expectedAuthType: "oidc-device-flow",
            },
            {
                description: "should return 'oidc-device-flow' for OIDC without any specific config",
                userConfig: {},
                connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC",
                expectedAuthType: "oidc-device-flow",
            },
            {
                description:
                    "should return 'oidc-device-flow' for OIDC with http transport on localhost and browser configured",
                userConfig: { transport: "http", httpHost: "localhost", browser: "chrome" },
                connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC",
                expectedAuthType: "oidc-auth-flow",
            },
        ];

        for (const { description, userConfig, connectionString, expectedAuthType } of testCases) {
            it(description, () => {
                const result = getAuthType(userConfig as UserConfig, connectionString);
                expect(result).toBe(expectedAuthType);
            });
        }
    });

    describe("getConnectionStringInfo", () => {
        const atlasClusterInfo: AtlasClusterConnectionInfo = {
            username: "testuser",
            projectId: "project123",
            clusterName: "TestCluster",
            expiryDate: new Date("2025-12-31"),
        };

        it("should return both authType and hostType for a standard connection string", () => {
            const connectionString = "mongodb://localhost:27017";
            const config = {} as UserConfig;

            const result = getConnectionStringInfo(connectionString, config);

            expect(result).toEqual({
                authType: "scram",
                hostType: "unknown",
            });
        });

        it("should return atlas hostType for Atlas connection strings", () => {
            const connectionString = "mongodb+srv://user:password@cluster.mongodb.net/database";
            const config = {} as UserConfig;

            const result = getConnectionStringInfo(connectionString, config);

            expect(result).toEqual({
                authType: "scram",
                hostType: "atlas",
            });
        });

        it("should override hostType to atlas when atlasInfo is provided", () => {
            const connectionString = "mongodb://localhost:27017";
            const config = {} as UserConfig;

            const result = getConnectionStringInfo(connectionString, config, atlasClusterInfo);

            expect(result).toEqual({
                authType: "scram",
                hostType: "atlas",
            });
        });

        it("should not override hostType when atlasInfo is undefined", () => {
            const connectionString = "mongodb://localhost:27017";
            const config = {} as UserConfig;

            const result = getConnectionStringInfo(connectionString, config, undefined);

            expect(result).toEqual({
                authType: "scram",
                hostType: "unknown",
            });
        });

        it("should correctly combine auth type and host type for OIDC on Atlas", () => {
            const connectionString = "mongodb+srv://user@cluster.mongodb.net/database?authMechanism=MONGODB-OIDC";
            const config = { transport: "stdio", browser: "firefox" } as UserConfig;

            const result = getConnectionStringInfo(connectionString, config);

            expect(result).toEqual({
                authType: "oidc-auth-flow",
                hostType: "atlas",
            });
        });

        it("should correctly handle X.509 auth on Atlas", () => {
            const connectionString = "mongodb+srv://user@cluster.mongodb.net/database?authMechanism=MONGODB-X509";
            const config = {} as UserConfig;

            const result = getConnectionStringInfo(connectionString, config);

            expect(result).toEqual({
                authType: "x.509",
                hostType: "atlas",
            });
        });

        it("should not fail if atlasInfo is undefined", () => {
            // This tests that the override is applied consistently
            const connectionString = "mongodb+srv://user:password@cluster.mongodb.net/database";
            const config = {} as UserConfig;

            const result = getConnectionStringInfo(connectionString, config, undefined);

            expect(result.hostType).toBe("atlas");
        });

        it("should handle LDAP auth with local connection", () => {
            const connectionString = "mongodb://localhost:27017?authMechanism=PLAIN&authSource=$external";
            const config = {} as UserConfig;

            const result = getConnectionStringInfo(connectionString, config);

            expect(result).toEqual({
                authType: "ldap",
                hostType: "unknown",
            });
        });

        it("should set hostType to atlas when atlasInfo is provided even with non-Atlas connection string", () => {
            // This simulates connecting to an Atlas cluster via a non-standard connection string
            // (e.g., through a private endpoint or proxy)
            const connectionString = "mongodb://private-endpoint.example.com:27017";
            const config = {} as UserConfig;

            const result = getConnectionStringInfo(connectionString, config, atlasClusterInfo);

            expect(result).toEqual({
                authType: "scram",
                hostType: "atlas",
            });
        });
    });
});
