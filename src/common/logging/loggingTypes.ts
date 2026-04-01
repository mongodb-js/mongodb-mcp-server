// Re-export logging types from @mongodb-mcp/logging
export type { LogLevel, LogPayload, LoggerType, EventMap, DefaultEventMap, MongoLogId } from "@mongodb-mcp/logging";

// Main-package-specific exports
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

export const MCP_LOG_LEVELS = LoggingMessageNotificationSchema.shape.params.shape.level.options;
