import type { DatabaseUserRole } from "@mongodb-js/mcp-atlas-api-client";
import type { IAtlasConfig } from "../atlasTool.js";

/**
 * The built-in Atlas database user roles, per the Atlas Admin API
 * (DatabaseUserRole.roleName). Any value outside this set must be a
 * project-scoped custom role.
 * https://www.mongodb.com/docs/atlas/mongodb-users-roles-and-privileges/
 */
export const BUILT_IN_DB_USER_ROLES = [
    "atlasAdmin",
    "backup",
    "clusterMonitor",
    "dbAdmin",
    "dbAdminAnyDatabase",
    "enableSharding",
    "read",
    "readAnyDatabase",
    "readWrite",
    "readWriteAnyDatabase",
] as const;

const readWriteRole: DatabaseUserRole = {
    roleName: "readWriteAnyDatabase",
    databaseName: "admin",
};

const readOnlyRole: DatabaseUserRole = {
    roleName: "readAnyDatabase",
    databaseName: "admin",
};

/**
 * Get the default role name for the database user based on the Atlas Admin API
 * https://www.mongodb.com/docs/atlas/mongodb-users-roles-and-privileges/
 */
export function getDefaultRoleFromConfig(config: IAtlasConfig): DatabaseUserRole {
    if (config.readOnly) {
        return readOnlyRole;
    }

    // If any of the write tools are enabled, use readWriteAnyDatabase
    if (
        !config.disabledTools.includes("create") ||
        !config.disabledTools.includes("update") ||
        !config.disabledTools.includes("delete")
    ) {
        return readWriteRole;
    }

    return readOnlyRole;
}
