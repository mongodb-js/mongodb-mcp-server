/**
 * The components used to build the extended `appName` parameter on a MongoDB
 * connection string. Concrete helpers (e.g. `setAppNameParamIfMissing`) live
 * in `@mongodb-js/mcp-core`.
 */
export interface AppNameComponents {
    appName: string;
    deviceId?: Promise<string>;
    clientName?: string;
}

/**
 * Public interface for the device ID helper. The concrete `DeviceId` class
 * (with the static `create()` factory) lives in `@mongodb-js/mcp-core`.
 */
export interface IDeviceId {
    /**
     * Returns the device ID, waiting for the calculation to complete if
     * necessary.
     */
    get(): Promise<string>;

    /**
     * Cancels any in-flight device-ID resolution and aborts further work.
     */
    close(): void;
}

/**
 * Options for MongoDB connection string helpers. Concrete implementations
 * (e.g. `validateConnectionString`, `setAppNameParamIfMissing`) live in
 * `@mongodb-js/mcp-core`.
 */
export interface ConnectionOptions {
    /** The MongoDB connection string (URI). */
    connectionString: string;
    /**
     * When `true`, the connection string parser applies loose validation rules
     * (e.g. allows unknown query parameters).
     */
    looseValidation?: boolean;
    /** Components used to build the extended `appName` URI parameter. */
    appNameComponents?: AppNameComponents;
}
