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

/** Server metadata for the server. */
export type ServerMetadata = {
    version: string;
    mcpServerName: string;
    engines?: { node: string };
};
