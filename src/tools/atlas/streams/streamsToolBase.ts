import { z } from "zod";
import { AtlasToolBase } from "../atlasTool.js";
import type { ToolArgs } from "../../tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiClientError } from "../../../common/atlas/apiClientError.js";
import type { StreamsToolMetadata } from "../../../telemetry/types.js";

export abstract class StreamsToolBase extends AtlasToolBase {
    protected override handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {
        if (error instanceof ApiClientError) {
            const statusCode = error.response.status;

            if (statusCode === 404) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Resource not found: ${error.message}\n\nUse \`atlas-streams-discover\` to list available workspaces, connections, and processors.`,
                        },
                    ],
                    isError: true,
                };
            }

            if (statusCode === 403 && error.message.includes("active") && error.message.includes("processor")) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Received a Forbidden API Error: ${error.message}\n\nThis may be because the workspace has active processors. Stop all processors first with \`atlas-streams-manage\` action 'stop-processor', then retry deletion.`,
                        },
                    ],
                    isError: true,
                };
            }

            if (statusCode === 400) {
                const msg = error.message;
                let hint =
                    "This usually indicates invalid configuration or pipeline syntax. Check the request parameters and try again.";

                if (msg.includes("IDLUnknownField") && msg.includes("topic") && msg.includes("AtlasCollection")) {
                    hint =
                        "The 'topic' field is not valid inside $merge. Use $emit (not $merge) to write to Kafka: {$emit: {connectionName, topic}}.";
                } else if (msg.includes("IDLUnknownField") && msg.includes("schemaRegistryName")) {
                    hint =
                        "Use schemaRegistry: {connectionName, valueSchema: {type: 'avro', schema: {<avro-def>}}} instead of schemaRegistryName.";
                } else if (msg.includes("IDLFailedToParse") && msg.includes("valueSchema") && msg.includes("missing")) {
                    hint =
                        "schemaRegistry.valueSchema is required. Include: {type: 'avro', schema: {<avro-schema-definition>}, options: {autoRegisterSchemas: true}}.";
                } else if (msg.includes("BadValue") && msg.includes("Enumeration") && msg.includes("type")) {
                    hint = "Schema type values are case-sensitive. Use lowercase 'avro' (not 'AVRO' or 'Avro').";
                } else if (msg.includes("IDLUnknownField") && msg.includes("MergeOperatorSpec")) {
                    hint =
                        "Invalid field in $merge stage. $merge writes to Atlas clusters: {$merge: {into: {connectionName, db, coll}}}. For Kafka/external sinks, use $emit instead.";
                }

                return {
                    content: [
                        {
                            type: "text",
                            text: `Bad Request: ${msg}\n\n${hint}`,
                        },
                    ],
                    isError: true,
                };
            }

            if (statusCode === 409) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Conflict: ${error.message}\n\nThe resource may already exist or be in a state that prevents this operation. Use \`atlas-streams-discover\` to check current state.`,
                        },
                    ],
                    isError: true,
                };
            }
        }

        if (error instanceof Error && error.message.includes("resumeFromCheckpoint")) {
            return {
                content: [
                    {
                        type: "text",
                        text:
                            `Checkpoint conflict: ${error.message}\n\n` +
                            `This typically occurs when a window stage interval was changed. Options:\n` +
                            `1. Restart with resumeFromCheckpoint=false (drops accumulated window state)\n` +
                            `2. Delete and recreate the processor if option 1 doesn't work`,
                    },
                ],
                isError: true,
            };
        }

        if (
            error instanceof Error &&
            (error.message.includes("SASL") || error.message.includes("authentication failed"))
        ) {
            return {
                content: [
                    {
                        type: "text",
                        text:
                            `Authentication failure: ${error.message}\n\n` +
                            `Check your Kafka connection credentials. Common issues:\n` +
                            `- Password may have a prefix (e.g. 'cflt/') that must be included\n` +
                            `- Mechanism mismatch (PLAIN vs SCRAM-256 vs SCRAM-512)\n` +
                            `Use \`atlas-streams-discover\` with action 'diagnose-processor' to see detailed error logs.`,
                    },
                ],
                isError: true,
            };
        }

        if (error instanceof Error && error.message.includes("INVALID_STATE")) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Invalid state transition: ${error.message}\n\nUse \`atlas-streams-discover\` with action 'inspect-processor' to check the current processor state before retrying.`,
                    },
                ],
                isError: true,
            };
        }

        return super.handleError(error, args);
    }

    protected static extractConnectionNames(obj: unknown): Set<string> {
        const names = new Set<string>();
        if (Array.isArray(obj)) {
            for (const item of obj) {
                for (const name of StreamsToolBase.extractConnectionNames(item)) {
                    names.add(name);
                }
            }
        } else if (obj !== null && typeof obj === "object") {
            const record = obj as Record<string, unknown>;
            for (const [key, value] of Object.entries(record)) {
                if (key === "connectionName" && typeof value === "string") {
                    names.add(value);
                } else {
                    for (const name of StreamsToolBase.extractConnectionNames(value)) {
                        names.add(name);
                    }
                }
            }
        }
        return names;
    }

    protected override resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        { result }: { result: CallToolResult }
    ): StreamsToolMetadata {
        const baseMetadata = super.resolveTelemetryMetadata(args, { result });
        const metadata: StreamsToolMetadata = { ...baseMetadata };

        const argsShape = z.object(this.argsShape);
        const parsedResult = argsShape.safeParse(args);
        if (!parsedResult.success) {
            return metadata;
        }

        const data = parsedResult.data;

        // Top-level `action` (discover/teardown) or the first entry of `operation[]` (manage).
        if ("action" in data && typeof data.action === "string") {
            metadata.action = data.action;
        } else if (Array.isArray(data.operation) && data.operation.length > 0) {
            const firstOp = data.operation[0] as { action?: unknown };
            if (typeof firstOp?.action === "string") {
                metadata.action = firstOp.action;
            }
        }
        if ("resource" in data && typeof data.resource === "string") {
            metadata.resource = data.resource;
        }

        return metadata;
    }
}
