import { MongoClientOptions } from "mongodb";
import ConnectionString from "mongodb-connection-string-url";

export interface AppNameComponents {
    appName: string;
    deviceId?: Promise<string>;
    clientName?: string;
}

/**
 * Sets the appName parameter with the extended format: appName--deviceId--clientName
 * Only sets the appName if it's not already present in the connection string
 * @param connectionString - The connection string to modify
 * @param components - The components to build the appName from
 * @returns The modified connection string
 */
export async function setAppNameParamIfMissing({
    connectionString,
    components,
}: {
    connectionString: string;
    components: AppNameComponents;
}): Promise<string> {
    const connectionStringUrl = new ConnectionString(connectionString);
    const searchParams = connectionStringUrl.typedSearchParams<MongoClientOptions>();

    // Only set appName if it's not already present
    if (searchParams.has("appName")) {
        return connectionStringUrl.toString();
    }

    const deviceId = components.deviceId ? await components.deviceId : "unknown";

    const clientName = components.clientName || "unknown";

    // Build the extended appName format: appName--deviceId--clientName
    const extendedAppName = `${components.appName}--${deviceId}--${clientName}`;

    searchParams.set("appName", extendedAppName);

    return connectionStringUrl.toString();
}
