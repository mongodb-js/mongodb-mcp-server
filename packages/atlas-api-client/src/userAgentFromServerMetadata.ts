import type { ServerMetadata } from "@mongodb-js/mcp-types";

export function userAgentFromServerMetadata(serverMetadata: ServerMetadata): string {
    return `${serverMetadata.mcpServerName}/${serverMetadata.version}`;
}
