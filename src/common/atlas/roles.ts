import { UserConfig } from "../config.js";
import { DatabaseUserRole } from "./openapi.js";

/**
 * Get the default role name for the database user based on the Atlas Admin API
 * https://www.mongodb.com/docs/atlas/mongodb-users-roles-and-privileges/
 */
export function getDefaultRoleFromConfig(config: UserConfig): DatabaseUserRole {
    if (config.readOnly) {
        return {
            roleName: "readAnyDatabase",
            databaseName: "admin",
        };
    }

    // If all write tools are enabled, use readWriteAnyDatabase
    if (
        !config.disabledTools?.includes("create") &&
        !config.disabledTools?.includes("update") &&
        !config.disabledTools?.includes("delete") &&
        !config.disabledTools?.includes("metadata")
    ) {
        return {
            roleName: "readWriteAnyDatabase",
            databaseName: "admin",
        };
    }

    return {
        roleName: "readAnyDatabase",
        databaseName: "admin",
    };
}
