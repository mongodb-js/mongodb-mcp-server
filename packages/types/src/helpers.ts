/**
 * A value that may be provided either synchronously or as a promise.
 */
export type MaybePromise<T> = T | Promise<T>;

export type AppNameComponents = {
    appName: string;
    deviceId?: Promise<string>;
    clientName?: string;
};

export interface IDeviceId {
    get(): Promise<string>;
    close(): void;
}
