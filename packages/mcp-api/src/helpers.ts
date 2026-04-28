export interface AppNameComponents {
    appName: string;
    deviceId?: Promise<string>;
    clientName?: string;
}

export interface IDeviceId {
    get(): Promise<string>;
    close(): void;
}
