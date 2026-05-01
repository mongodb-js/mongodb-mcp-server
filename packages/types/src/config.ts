export type TransportType = "stdio" | "http";

export interface IToolConfig {
    transport: TransportType | string;
    httpBodyLimit?: number;
    readOnly: boolean;
    disabledTools: string[];
    confirmationRequiredTools: string[];
    previewFeatures: string[];
}
