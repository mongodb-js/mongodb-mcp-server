import type { MongoLogId } from "mongodb-log-writer";
import type { LogPayload } from "@mongodb-js/mcp-types";

export type MongoLogPayload = LogPayload<MongoLogId>;
