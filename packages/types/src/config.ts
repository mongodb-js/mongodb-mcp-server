import type { PreviewFeature } from "./schemas.js";

export type TransportType = "stdio" | "http";

export interface IToolConfig {
    transport: TransportType;
    httpBodyLimit?: number;
    readOnly: boolean;
    disabledTools: string[];
    confirmationRequiredTools: string[];
    previewFeatures: PreviewFeature[];
}
