import { describe, it, expect } from "vitest";
import { getHostType } from "../../../src/common/connectionInfo.js";

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
            const connectionStringWithSpecialChars =
                "mongodb+srv://user:p%40ssw%3Drd@cluster.mongodb.net/database";

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
            const privateEndpointConnectionString =
                "mongodb+srv://user:password@cluster.abc123.mongodb.net/database";

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
});
