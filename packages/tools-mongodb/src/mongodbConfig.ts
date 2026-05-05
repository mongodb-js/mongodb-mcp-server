import type { IToolConfig } from "@mongodb-js/mcp-types";

export interface IMongoDBConfig extends IToolConfig {
    connectionString?: string;
    maxTimeMS?: number;
    indexCheck?: boolean;
    maxDocumentsPerQuery?: number;
    maxBytesPerQuery?: number;
    httpHost?: string;
}
