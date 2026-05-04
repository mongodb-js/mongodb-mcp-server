export type TransportType = "stdio" | "http";

export interface IToolConfig {
    transport: string;
    httpBodyLimit?: number;
    readOnly: boolean;
    disabledTools: string[];
    confirmationRequiredTools: string[];
    previewFeatures: string[];
}
